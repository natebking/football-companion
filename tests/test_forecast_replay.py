import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engine'))
import buckets
import export_tables
import freeze_context_candidate as freeze
import replay_forecasts as replay
from test_coaching_pilot import fixture


class ForecastReplayTest(unittest.TestCase):
    def test_future_training_rows_are_rejected_before_fitting(self):
        frame = fixture(); frame.loc[frame.index[0], 'season'] = 2026
        with self.assertRaisesRegex(ValueError, 'future season'):
            freeze.refit(frame, 'nfl', {})

    def test_baseline_reader_matches_reference_in_both_leagues(self):
        for league in ['cfb', 'nfl']:
            table = json.loads((ROOT / f'web/tendency-{league}.json').read_text())
            rows, expected = [], []
            for team in [None] + list(table['teams'])[:3]:
                for key in buckets.BUCKET_KEYS:
                    down, distance, ytg = export_tables.probe(key)
                    value = export_tables.lookup(table, team, down, distance, ytg)
                    expected.append(value['pass_rate'] if value['can_attribute'] else value['league_pass_rate'])
                    rows.append({'team': team, 'down': down, 'distance': distance, 'yardsToGoal': ytg})
            script = "const fs=require('fs'),a=require('./engine/forecast_replay.js'),d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(d.rows.map(r=>a.baselineProbability(d.table,r))));"
            run = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps({'table': table, 'rows': rows}), text=True, capture_output=True, check=True)
            self.assertEqual(json.loads(run.stdout), expected)

    def test_minimum_and_development_gates_do_not_report_tiny_sample_accuracy(self):
        results = [{'game': 'cfb:1', 'league': 'cfb', 'rows': [
            {'eligible': True, 'cohort': 'development', 'displayed': .4, 'reasons': []},
            {'eligible': True, 'cohort': 'prospective', 'displayed': None, 'reasons': []}]}]
        report = replay.summarize(results)
        self.assertIsNone(report['cfb']['cohorts']['development']['scores'])
        self.assertIsNone(report['cfb']['cohorts']['prospective']['scores'])
        self.assertEqual(report['cfb']['cohorts']['prospective']['plays'], 1)
        self.assertEqual(report['nfl']['cohorts']['prospective']['plays'], 0)

    def test_college_outcomes_require_exact_offense_and_keep_unknown_context(self):
        game = {'key': 'cfb:123', 'meta': {'gameId': '123', 'league': 'cfb'}}
        review = {'key': game['key'], 'status': 'final', 'teams': [{'id': '1', 'shortName': 'A'}],
                  'plays': [{'id': 'p', 'report': {'start': {'team': {'id': '1'}}}}]}
        source = {'status': 200, 'url': 'https://api.collegefootballdata.com/plays?year=2026', 'retrievedAt': 'test',
                  'payload': [{'gameId': '123', 'id': 'p', 'offense': 'B', 'playType': 'Pass Reception',
                               'playText': '(03:10) pass complete', 'down': 1, 'distance': 10, 'yardsToGoal': 70}]}
        self.assertEqual(replay.college_labels(game, review, source, 'test')['rejectedIds'], ['p'])
        source['payload'][0]['offense'] = 'A'
        row = replay.college_labels(game, review, source, 'test')['plays']['p']
        self.assertTrue(row['eligible']); self.assertEqual(row['clockSeconds'], 190); self.assertIsNone(row['scoreDiff'])


if __name__ == '__main__':
    unittest.main()

from collections import Counter
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engine'))
import audit_cfb_labels as audit
import ingest_cfb


class CFBLabelTests(unittest.TestCase):
    def row(self, kind, text):
        return dict(playType=kind, playText=text, down=2, distance=10, yardsToGoal=60)

    def test_sacks_and_scrambles_match_the_historical_target_not_quiz_grades(self):
        self.assertEqual(audit.label(self.row('Sack', 'Quarterback sacked for a loss.'))['passLabel'], 1)
        self.assertEqual(audit.label(self.row('Rush', 'Quarterback scrambles for 8 yards.'))['passLabel'], 0)
        fumble = self.row('Fumble Recovery (Opponent)', 'K.Weisman scrambles for 8 yards. K.Weisman FUMBLES.')
        self.assertEqual(audit.label(fumble)['passLabel'], 0)

    def test_a_known_rush_label_cannot_override_explicit_no_play(self):
        for kind in ['Rush', 'Pass Reception', 'Uncategorized']:
            self.assertFalse(audit.label(self.row(kind, 'Quarterback runs. PENALTY. No Play.'))['eligible'])
        self.assertEqual(ingest_cfb.classify('Rush', 'Run for 4 yards. Original Play: PENALTY. NO PLAY.')[0], 'rush')
        self.assertFalse(audit.label(self.row('Rush', 'Quarterback kneels for a loss.'))['eligible'])

    def test_ingestion_uses_reported_snap_clock_and_preserves_unknown(self):
        def build(text, clock):
            row = dict(self.row('Rush', text), id='1', gameId=1, period=4, clock=clock,
                       offense='A', defense='B', home='A', yardsGained=4)
            stats = dict(type_counts=Counter(), seen=set(), type_category=Counter(), dropped=Counter(), duplicates=0, clamped_yards=0)
            return ingest_cfb.build_rows([row], 2026, 1, stats)[0]
        self.assertEqual(build('(02:03) Run for 4 yards.', {'minutes': 1, 'seconds': 56})['clock_seconds'], 123)
        self.assertEqual(build('Run for 4 yards.', {'minutes': 1, 'seconds': 56})['clock_seconds'], 116)
        self.assertIsNone(build('Run for 4 yards.', None)['clock_seconds'])

    def test_final_join_requires_exact_game_play_and_offense(self):
        game = {'key': 'cfb:1', 'meta': {'gameId': '1'}, 'sources': [], 'shown': [], 'observations': []}
        review = {'key': 'cfb:1', 'status': 'final', 'teams': [{'id': 'a', 'shortName': 'A'}],
                  'plays': [{'id': 'p', 'report': {'start': {'team': {'id': 'a'}}}}]}
        row = dict(self.row('Rush', 'Run for 4 yards.'), id='p', gameId=1, offense='A')
        source = {'status': 200, 'url': 'https://example.test/plays', 'retrievedAt': '2026-09-06', 'payload': [row, dict(row, gameId=2)]}
        self.assertEqual(audit.audit(game, review, source)['matchedGamePlayOffense'], 1)
        source['payload'][0] = dict(row, offense='B')
        self.assertEqual(audit.audit(game, review, source)['matchedGamePlayOffense'], 0)
        source['payload'] = [row, row]
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            audit.audit(game, review, source)


if __name__ == '__main__':
    unittest.main()

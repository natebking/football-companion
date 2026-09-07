from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import sys
import unittest
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engine'))
import history_profiles as history
import source_context


def play(kind='Rush', text='Runner gains 7 yards.', gained=7, distance=7):
    return SimpleNamespace(play_type_raw=kind, play_text=text, yards_gained=gained, distance=distance)


class HistoryTest(unittest.TestCase):
    def test_college_conversion_has_explicit_unknowns(self):
        self.assertTrue(history.college_conversion(play()))
        self.assertFalse(history.college_conversion(play(gained=6)))
        self.assertFalse(history.college_conversion(play('Sack', gained=-5)))
        self.assertFalse(history.college_conversion(play('Interception Return', gained=80)))
        self.assertTrue(history.college_conversion(play('Rushing Touchdown', gained=2, distance=2)))
        for p in [play(text='PENALTY, automatic first down.'), play('Fumble Recovery (Own)'),
                  play(text='Runner fumbles, recovered at the 30.'), play(gained=None), play('Unknown')]:
            self.assertIsNone(history.college_conversion(p))
        self.assertTrue(history.college_conversion(play(text='Rush for 7. Original Play: PENALTY, NO PLAY')))

    def test_return_or_penalty_yards_do_not_become_offensive_gains(self):
        frame = pd.DataFrame([vars(play('Interception Return', 'Intercepted, return 70 yards.', 70)),
                              vars(play('Pass Reception', 'Pass for 5. PENALTY advances to 30.', 20)),
                              vars(play(text='Rush for 7. Original Play: PENALTY, NO PLAY'))])
        result = history.attach_outcomes(frame, 'cfb', 2025)
        self.assertTrue(result.yards_gained.iloc[:2].isna().all())
        self.assertEqual(result.yards_gained.iloc[2], 7)

    def test_nfl_joins_exact_ids_and_preserves_unknowns_or_turnovers(self):
        frame = pd.DataFrame({'game_id': ['g']*4, 'play_id': ['1','2','3','4'], 'offense': ['A']*4, 'yards_gained': [7]*4})
        raw = pd.DataFrame({'game_id': ['g']*4, 'play_id': [1,2,3,4], 'posteam': ['A','A','B','A'],
            'first_down': [1,1,1,1], 'touchdown': [0]*4, 'td_team': [None]*4,
            'fumble_lost': [0,1,0,0], 'interception': [0]*4, 'penalty': [0,0,0,1]})
        with patch.object(history.pd, 'read_parquet', return_value=raw):
            result = history.attach_outcomes(frame, 'nfl', 2025)
        self.assertEqual(result.converted.tolist(), [True,False,None,None])
        self.assertTrue(result.yards_gained.iloc[2:].isna().all())

    def test_context_excludes_unknown_and_impossible_situations(self):
        row = dict(down=3, distance=8, yards_to_goal=70, period=1, clock_seconds=600, score_diff=0)
        frame = pd.DataFrame([row, {**row,'score_diff':None}, {**row,'clock_seconds':None}, {**row,'distance':71},
                              {**row,'distance':3,'yards_to_goal':3,'period':4,'clock_seconds':300,'score_diff':-9}])
        keys = history.context(frame)
        self.assertEqual(keys.iloc[0], 'd3|long|open|close|ordinary')
        self.assertTrue(keys.iloc[1:4].isna().all())
        self.assertEqual(keys.iloc[4], 'd3|short|goal|behind|late')

    def test_shared_source_alignment_preserves_snap_clock_and_voided_play_rules(self):
        row = dict(play_type_raw='Rush', play_text='(02:03) Runner gains 4.', is_pass=False, is_rush=True,
                   is_special=False, is_penalty_only=False, down=2, distance=6, yards_to_goal=50, period=2, clock_seconds=116)
        frame = pd.DataFrame([row, {**row, 'play_text':'(02:03) Rush. PENALTY. NO PLAY.'}])
        result, audit = source_context.align(frame, 'cfb')
        self.assertEqual(result.clock_seconds.tolist(), [123,123])
        self.assertEqual(result.is_penalty_only.tolist(), [False,True])
        self.assertEqual(audit['clockAudit']['eligiblePhaseChanges'], 1)
        self.assertEqual(frame.clock_seconds.tolist(), [116,116], 'The archived input is unchanged.')


if __name__ == '__main__':
    unittest.main()

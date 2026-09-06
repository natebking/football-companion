"""Chronology, calibration and client parity for the offline context candidate."""
from pathlib import Path
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
import context_evaluation as context
import coaching_pilot as pilot
import ingest_cfb
from test_coaching_pilot import fixture


def prepared():
    f = fixture()
    f["week"] = np.where(f.play_index < 12, 1, 12).astype("int8")
    f["game_id"] = f.game_id + "_" + f.week.astype(str)
    return pilot.prepare(f, {"assignments": [], "exceptions": []})


class ContextEvaluationTest(unittest.TestCase):
    def test_explicit_snap_clock_is_not_confused_with_end_clock_or_later_prose(self):
        self.assertEqual(ingest_cfb.text_clock('(02:03) Shotgun pass complete; clock 01:56'), 123)
        self.assertEqual(ingest_cfb.text_clock('(00:00) End of game'), 0)
        for text in ['Timeout, clock 02:03', '(02:75) pass', '(15:01) rush', 'A 2:03 drive', None, float('nan')]:
            self.assertIsNone(ingest_cfb.text_clock(text))

    def test_calibration_and_tuning_games_precede_test_and_are_disjoint(self):
        d = prepared()
        before, tuning, calibration, test = context.split(d)
        self.assertLess(before.season.max(), tuning.season.min())
        self.assertLess(tuning.week.max(), calibration.week.min())
        self.assertLess(calibration.season.max(), test.season.min())
        damaged = d.copy()
        row = damaged[(damaged.season == 2024) & (damaged.week == 12)].index[0]
        damaged.loc[row, "game_id"] = tuning.game_id.iloc[0]
        with self.assertRaisesRegex(ValueError, "crosses"):
            context.split(damaged)

    def test_holdout_label_changes_cannot_alter_parameters_or_client_predictions(self):
        d = prepared()
        def candidate(frame):
            before, tuning, calibration, test = context.split(frame)
            ck, ik, _, _ = pilot.tune(before, tuning)
            import pandas as pd
            calbase = pd.concat([before, tuning])
            cal = context.fit_calibration(context.predict(context.fit(calbase, ck, ik), calibration), calibration.actual)
            train = pd.concat([calbase, calibration])
            models = context.fit(train, ck, ik)
            pred = context.calibrated(context.predict(models, test), cal)
            export = context.export_model(models, cal, train, "nfl")
            self.assertTrue(context.client_parity(export, test, pred)["passed"])
            return export, pred
        first, predictions = candidate(d)
        d.loc[d.season == 2025, "actual"] = 1 - d.loc[d.season == 2025, "actual"]
        second, changed = candidate(d)
        self.assertEqual(first, second)
        np.testing.assert_array_equal(predictions, changed)


if __name__ == "__main__":
    unittest.main()

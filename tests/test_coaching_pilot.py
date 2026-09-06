"""Protect chronology and honest caller attribution in the offline pilot."""
import json
from pathlib import Path
import sys
import unittest

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
import coaching_pilot as pilot
import schema


def fixture():
    rows = []
    for season in range(2018, 2026):
        for team in ("NO", "DEN", "KC"):
            for i in range(24):
                passed = (i + season) % 3 != 0
                rows.append(dict(league="nfl", season=season, week=1,
                    game_id=f"{season}_01_{team}_X", play_id=str(i), play_index=i,
                    offense=team, defense="X", period=4 if i < 8 else 1,
                    clock_seconds=60 if i < 8 else 600, down=1 + i % 3,
                    distance=10 if i % 3 == 0 else 4, yards_to_goal=50,
                    play_type_raw="pass" if passed else "run", is_pass=passed,
                    is_rush=not passed, is_special=False, is_penalty_only=False,
                    yards_gained=5, value=.1, success=True, score_diff=-10 if i < 8 else 0,
                    play_text="irrelevant post-play description"))
    return schema.conform(pd.DataFrame(rows))


class CoachingPilotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads(pilot.SOURCE_PATH.read_text())

    def test_actual_caller_does_not_follow_head_coach_through_role_change(self):
        rows = pd.DataFrame({"offense": ["DEN", "DEN", "NO", "NO", "NO", "KC"],
            "season": [2025, 2026, 2021, 2021, 2022, 2025],
            "game_id": ["a", "b", "2021_15_NO_TB", "2021_16_MIA_NO", "c", "d"]})
        caller, tenure = pilot.caller_labels(rows, self.catalog)
        self.assertEqual(caller.tolist(), ["sean_payton", "davis_webb", None, "sean_payton", None, None])
        self.assertNotEqual(tenure.iloc[0], tenure.iloc[3])

    def test_unknown_context_is_not_assumed_tied_or_zero_seconds(self):
        f = fixture()
        f.loc[0, "score_diff"] = pd.NA
        f.loc[1, "clock_seconds"] = pd.NA
        prepared = pilot.prepare(f, self.catalog)
        self.assertEqual(len(prepared), len(f) - 2)
        self.assertEqual(prepared.iloc[0].phase, "last_2min")
        self.assertEqual(prepared.iloc[0].score_band, "behind_9plus")

    def test_holdout_outcomes_cannot_change_tuning_or_predictions(self):
        d = pilot.prepare(fixture(), self.catalog)
        train, validation, refit, test = pilot.chronological_split(d, 2024)
        ck, ik, _, _ = pilot.tune(train, validation)
        model = pilot.fit_context(refit, ck)
        identity = pilot.fit_identity(refit, model, "caller", ik)
        before = pilot.predict_identity(model, identity, test, "caller")
        changed = d.copy()
        changed.loc[changed.season >= 2024, "actual"] = 1 - changed.loc[changed.season >= 2024, "actual"]
        a, b, c, future = pilot.chronological_split(changed, 2024)
        self.assertEqual((ck, ik), pilot.tune(a, b)[:2])
        new_model = pilot.fit_context(c, ck)
        after = pilot.predict_identity(new_model, pilot.fit_identity(c, new_model, "caller", ik), future, "caller")
        np.testing.assert_array_equal(before, after)
        with self.assertRaisesRegex(ValueError, "overlap"):
            pilot.tune(validation, validation)

    def test_unseen_caller_and_new_tenure_use_context_only(self):
        d = pilot.prepare(fixture(), self.catalog)
        _, _, train, test = pilot.chronological_split(d, 2023)
        model = pilot.fit_context(train, 30)
        base = pilot.predict_context(model, test)
        same_team = pilot.predict_identity(model, pilot.fit_identity(train, model, "tenure", 60), test, "tenure")
        # Denver has no Payton tenure observations until 2023; KC is unmapped.
        selected = test.offense.isin(["DEN", "KC"]).to_numpy()
        np.testing.assert_array_equal(base[selected], same_team[selected])

    def test_mapping_sources_resolve_and_ranges_do_not_overlap(self):
        for item in self.catalog["assignments"] + self.catalog["exceptions"]:
            self.assertTrue(item["sourceIds"])
            for source in item["sourceIds"]:
                self.assertTrue(self.catalog["sources"][source]["url"].startswith("https://"))
        duplicate = dict(self.catalog, assignments=self.catalog["assignments"] * 2)
        with self.assertRaisesRegex(ValueError, "overlapping"):
            pilot.caller_labels(fixture(), duplicate)

    def test_bootstrap_is_paired_and_grouped_by_game(self):
        d = pd.DataFrame({"game_id": ["g1"] * 4 + ["g2"] * 4,
                          "actual": [0, 1] * 4, "a": [.5] * 8, "b": [.5] * 8})
        result = pilot.paired_bootstrap(d, "a", "b")
        self.assertEqual(result["clusters"], 2)
        self.assertEqual(result["interval95"], [0., 0.])
        self.assertEqual(result["verdict"], "not established")


if __name__ == "__main__":
    unittest.main()

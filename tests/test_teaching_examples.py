"""Historical lessons must remain tied to their recorded source observations."""
import json
from pathlib import Path
import sys
import unittest

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
import export_teaching_examples as lessons


class TeachingExamplesTest(unittest.TestCase):
    def setUp(self):
        fixture = json.loads((ROOT / "tests/fixtures/teaching-examples-source.json").read_text())
        self.raw = pd.DataFrame(fixture["nfl"])
        self.charting = pd.DataFrame(fixture["ftn"])
        self.college = fixture["cfbd"]

    def test_six_real_lessons_reproduce_shipped_examples(self):
        actual = lessons.build(self.raw, self.charting, self.college)
        shipped = json.loads((ROOT / "web/teaching-examples.json").read_text())
        self.assertEqual(actual, shipped)
        self.assertEqual(len(actual["examples"]), 6)
        charted = [e for e in actual["examples"] if any("FTN" in s["label"] for s in e["sources"])]
        self.assertEqual(len(charted), 2)
        self.assertTrue(all(e["sources"][-1]["license"] == "CC-BY-SA 4.0" for e in charted))

    def test_changed_yardage_cannot_keep_old_lesson(self):
        self.raw.loc[self.raw.play_id == 2796, "yards_after_catch"] = 32
        with self.assertRaisesRegex(ValueError, "has changed"):
            lessons.build(self.raw, self.charting, self.college)

    def test_ambiguous_or_missing_charting_cannot_be_claimed(self):
        duplicate = pd.concat([self.charting, self.charting.iloc[:1]])
        with self.assertRaisesRegex(ValueError, "not unique"):
            lessons.build(self.raw, duplicate, self.college)
        self.charting.loc[self.charting.nflverse_play_id == 3106, "is_screen_pass"] = False
        with self.assertRaisesRegex(ValueError, "observation is missing"):
            lessons.build(self.raw, self.charting, self.college)


if __name__ == "__main__":
    unittest.main()

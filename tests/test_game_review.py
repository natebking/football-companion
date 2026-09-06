import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
import export_game_review as review


class GameReviewTests(unittest.TestCase):
    def test_join_requires_exact_game_play_and_offense(self):
        plays = [{"id": "p", "report": {"start": {"team": {"id": "68"}}}}]
        payload = [{"gameId": 1, "playId": "p", "offenseId": 68}, {"gameId": 2, "playId": "p", "offenseId": 68},
                   {"gameId": 1, "playId": "missing", "offenseId": 68}]
        joined, coverage = review.joined_rows({"status": 200, "payload": payload}, 1, plays)
        self.assertEqual(list(joined), ["p"])
        self.assertEqual(coverage["otherGames"], 1)
        payload[0]["offenseId"] = 2483
        self.assertEqual(review.joined_rows({"status": 200, "payload": payload}, 1, plays)[0], {})

    def test_duplicate_join_keys_are_excluded_not_multiplied(self):
        row = {"gameId": 1, "playId": "p"}
        joined, coverage = review.joined_rows({"status": 200, "payload": [row, row]}, 1, [{"id": "p", "report": {}}])
        self.assertEqual(joined, {})
        self.assertEqual(coverage["duplicateIds"], 1)

    def test_yardage_requires_arithmetic_and_independent_report_agreement(self):
        row = {"parseStatus": "complete", "outcome": "completion", "airYards": 3, "yardsAfterCatch": 33, "totalYards": 36}
        facts = {"gained": 36, "outcome": "pass", "voidReason": None, "turnover": False}
        self.assertTrue(review.passing_details(row, facts)["yardageVerified"])
        for changed in [dict(row, yardsAfterCatch=None), dict(row, airYards=4), dict(row, parseStatus="partial")]:
            self.assertIsNone(review.passing_details(changed, facts)["airYards"])
        self.assertFalse(review.passing_details(row, dict(facts, gained=35))["yardageVerified"])
        self.assertFalse(review.passing_details(row, dict(facts, airYards=4, yardsAfterCatch=32))["yardageVerified"])

    def test_rushing_sacks_and_unverified_success_do_not_become_teaching_claims(self):
        row = {"parseStatus": "complete", "rushingYards": -5, "isSack": True, "ppa": 9, "success": True}
        result = review.rushing_details(row, {"gained": None, "outcome": "other", "voidReason": "sack"})
        self.assertIsNone(result["rushingYards"])
        self.assertNotIn("ppa", result)
        self.assertNotIn("success", result)

    def test_wrong_game_and_unfinished_game_are_rejected(self):
        summary = {"header": {"id": "1", "competitions": [{"status": {"type": {"completed": False, "state": "in"}}}]}}
        with self.assertRaises(ValueError):
            review.final_reports(summary, "2")
        with self.assertRaises(ValueError):
            review.final_reports(summary, "1")

    def test_published_oregon_review_has_unique_ids_and_reconciled_enrichment(self):
        data = json.loads((ROOT / "web/reviews/cfb-401858433.json").read_text())
        self.assertEqual(data["status"], "final")
        self.assertEqual(data["label"], "Boise State at Oregon")
        self.assertEqual(len(data["plays"]), len({p["id"] for p in data["plays"]}))
        for kind in ("passing", "rushing"):
            self.assertEqual(data["coverage"][kind]["matched"], sum(p["enrichment"][kind] is not None for p in data["plays"]))
            self.assertGreaterEqual(data["coverage"][kind]["received"], data["coverage"][kind]["matched"])
        for play in data["plays"]:
            passing = play["enrichment"]["passing"]
            if passing and passing["yardageVerified"]:
                self.assertEqual(passing["airYards"] + passing["yardsAfterCatch"], passing["totalYards"])
        public = json.dumps(data).lower()
        self.assertNotIn("authorization", public)
        self.assertNotIn("bearer ", public)
        self.assertNotIn("cfbd_api_key", public)


if __name__ == "__main__":
    unittest.main()

"""Build small, source-checked historical lessons, separate from live game state.

Run with `.venv/bin/python engine/export_teaching_examples.py`.
nflverse PBP and the public FTN charting subset are cached in data/raw. The one
CFBD historical request uses the existing private key and is cached there too.
Keys never enter the output. FTN-derived records retain their attribution and
CC-BY-SA 4.0 notice; these records may be reused under that license.
"""
import hashlib
import json
from pathlib import Path

import pandas as pd
import requests

import ingest_cfb
import ingest_nfl

ROOT = Path(__file__).resolve().parents[1]
FTN_URL = "https://github.com/nflverse/nflverse-data/releases/download/ftn_charting/ftn_charting_2025.parquet"
CFBD_URL = "https://api.collegefootballdata.com/passing/plays"
CFBD_PARAMS = {"year": 2025, "team": "Oregon", "week": 1, "seasonType": "postseason"}
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
CONTENT = ROOT / "engine/teaching-content.json"
CHART_FIELDS = {"is_play_action": "playAction", "is_screen_pass": "screen", "is_motion": "motion",
                "n_pass_rushers": "passRushers", "n_blitzers": "blitzers"}


def _one(frame, game, play):
    rows = frame[(frame.game_id == game) & (frame.play_id == play)]
    if len(rows) != 1:
        raise ValueError("Expected one source play: {} / {}, found {}".format(game, play, len(rows)))
    row = rows.iloc[0]
    if row.penalty != 0 or row.fumble != 0 or row.interception != 0 or row.play_type not in ("run", "pass"):
        raise ValueError("Lessons require an unambiguous stand-alone scrimmage play")
    return row


def _base(row, lesson_id, topic, title, summary, explanation):
    return {
        "id": lesson_id, "topic": topic, "title": title, "league": "nfl",
        "season": int(row.season), "week": int(row.week),
        "gameId": row.game_id, "playId": str(int(row.play_id)),
        "offense": row.posteam, "defense": row.defteam,
        "summary": summary, "explanation": explanation,
        "facts": {"down": int(row.down), "distance": int(row.ydstogo),
                  "yardsGained": int(row.yards_gained)},
        "sources": [{"label": "nflverse play-by-play", "url": ingest_nfl.RELEASE_URL.format(int(row.season))}],
    }


def _passing_facts(example, row):
    if row.complete_pass != 1 or pd.isna(row.air_yards) or pd.isna(row.yards_after_catch):
        raise ValueError("Missing yardage components")
    if row.air_yards + row.yards_after_catch != row.yards_gained:
        raise ValueError("Yardage components do not reconcile")
    example["facts"].update({"airYards": int(row.air_yards), "yardsAfterCatch": int(row.yards_after_catch)})


def _chart_facts(example, row, charting, expected):
    matches = charting[(charting.nflverse_game_id == row.game_id) & (charting.nflverse_play_id == row.play_id)]
    if len(matches) != 1:
        raise ValueError("Required FTN observation is missing")
    chart = matches.iloc[0]
    if chart.season != row.season or chart.week != row.week:
        raise ValueError("FTN season/week does not match the play")
    for field, value in expected.items():
        if pd.isna(chart[field]) or chart[field] != value:
            raise ValueError("Required FTN observation is missing or changed: " + field)
        example["facts"][CHART_FIELDS[field]] = value
    example["sources"].append({"label": "FTN Data via nflverse", "url": FTN_URL,
                              "license": "CC-BY-SA 4.0", "licenseUrl": LICENSE_URL})


def build(raw, charting, college):
    if charting.duplicated(["nflverse_game_id", "nflverse_play_id"]).any():
        raise ValueError("FTN join keys are not unique")
    examples = []
    row = _one(raw, "2025_01_BAL_BUF", 2796)
    if tuple(row[["air_yards", "yards_after_catch", "yards_gained"]]) != (3, 33, 36):
        raise ValueError("The selected 3 + 33 yard play has changed")
    e = _base(row, "short-throw-big-gain", "yards-after-catch", "A short throw, a long gain",
              "Lamar Jackson found Zay Flowers for 36 yards.",
              "The catch was 3 yards beyond the starting line. Flowers added 33 after the catch. A 36-yard completion can come mostly from what happens with the ball in the receiver's hands.")
    _passing_facts(e, row)
    examples.append(e)

    for game, play, lesson, topic, title, summary, explanation, flag in [
        ("2025_01_BAL_BUF", 3106, "screen-behind-the-line", "screen", "Catch it behind the line",
         "Josh Allen completed a screen to James Cook for 51 yards.",
         "Cook caught the ball 3 yards behind the starting line, then gained 54 after the catch. FTN charted this as a screen. On a screen, look for blockers getting in front of the receiver. The data does not establish which block created the opening.", "is_screen_pass"),
        ("2025_01_ARI_NO", 1188, "fake-handoff-deep-pass", "play-action", "The handoff was a fake",
         "Kyler Murray completed a 45-yard pass to Marvin Harrison Jr.",
         "FTN charted a fake handoff and motion before the snap. The throw traveled 39 yards and Harrison added 6 after the catch. Watch the quarterback and running back first; their fake is part of the play's design. The charting does not prove a defender fell for it.", "is_play_action"),
    ]:
        row = _one(raw, game, play)
        e = _base(row, lesson, topic, title, summary, explanation)
        _passing_facts(e, row)
        _chart_facts(e, row, charting, {"is_play_action": flag == "is_play_action",
                                       "is_screen_pass": flag == "is_screen_pass", "is_motion": flag == "is_play_action"})
        examples.append(e)

    for game, play, lesson, title, explanation, expected in [
        ("2025_01_ARI_NO", 327, "five-yards-first-down", "Five yards that leave options",
         "Arizona needed 10 yards on first down. A 5-yard completion left second-and-five, with two more downs before a fourth-down decision. The useful detail is how much work remains.", (1, 10, 5)),
        ("2025_04_TEN_HOU", 1178, "five-yards-third-down", "The same gain, a different result",
         "Houston needed 8 yards on third down. A 5-yard completion left fourth-and-three. It gained ground but did not reach the marker. Compare it with the first-down example: the yards are identical; the consequence is different.", (3, 8, 5)),
    ]:
        row = _one(raw, game, play)
        if tuple(row[["down", "ydstogo", "yards_gained"]]) != expected:
            raise ValueError("Situation lesson no longer matches its source")
        e = _base(row, lesson, "down-and-distance", title, "Completed pass for 5 yards.", explanation)
        e["facts"].update({"nextDown": expected[0] + 1, "remaining": expected[1] - expected[2]})
        examples.append(e)

    matches = [p for p in college if p.get("playId") == "401769074527" and p.get("gameId") == 401769074]
    if len(matches) != 1:
        raise ValueError("Expected one CFBD source play")
    row = matches[0]
    if row["parseStatus"] != "complete" or (row["airYards"], row["yardsAfterCatch"], row["totalYards"]) != (43, 0, 43):
        raise ValueError("CFBD yardage no longer supports the lesson")
    examples.append({
        "id": "long-throw-college", "topic": "yards-after-catch", "title": "This time, the throw covered the ground",
        "league": "cfb", "season": row["season"], "week": row["week"], "seasonType": row["seasonType"],
        "gameId": str(row["gameId"]), "playId": row["playId"], "offense": row["offense"], "defense": row["defense"],
        "summary": "Dante Moore completed a 43-yard pass to Jeremiah McClellan.",
        "explanation": "CollegeFootballData parsed 43 yards through the air and none after the catch. Unlike the Flowers example, the throw accounted for the whole gain. These measurements come from the written play report, not player tracking.",
        "facts": {"down": row["down"], "distance": row["distance"], "yardsGained": row["totalYards"],
                  "airYards": row["airYards"], "yardsAfterCatch": row["yardsAfterCatch"]},
        "sources": [{"label": "CollegeFootballData enriched passing", "url": "https://api.collegefootballdata.com/api/passing"}],
    })
    content = json.loads(CONTENT.read_text())
    for entry in content["examples"]:
        row = _one(raw, entry["game"], entry["play"])
        for field, expected in entry["expected"].items():
            if pd.isna(row[field]) or row[field] != expected:
                raise ValueError("Selected lesson source changed: " + entry["id"] + " / " + field)
        e = _base(row, entry["id"], entry["topic"], entry["title"], entry["summary"], entry["explanation"])
        if row.complete_pass == 1:
            _passing_facts(e, row)
        if entry["charted"]:
            _chart_facts(e, row, charting, entry["charted"])
        examples.append(e)
    by_id = {e["id"]: e for e in examples}
    if len(by_id) != len(examples) or len({(e["league"], e["gameId"], e["playId"]) for e in examples}) != len(examples):
        raise ValueError("Duplicate example or source play")
    practice = content["practice"]
    if len({p["id"] for p in practice}) != len(practice):
        raise ValueError("Duplicate practice question")
    for p in practice:
        worked, other = by_id[p["workedExampleId"]], by_id[p["testExampleId"]]
        if (worked["league"], worked["gameId"]) == (other["league"], other["gameId"]):
            raise ValueError("Practice must use a different game")
        choices = [c["id"] for c in p["choices"]]
        if len(choices) != len(set(choices)) or p["answerId"] not in choices:
            raise ValueError("Practice answer does not match a unique choice")
    payload = {"generated": "2026-09-06", "version": content["version"], "kind": "historical-lessons",
               "notice": "Real plays from the 2025 season. Read an example, then try a different play. These use recorded facts and illustrations, not game video.",
               "examples": examples, "practice": practice}
    payload["contentHash"] = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return payload


def main():
    raw_path = Path(ingest_nfl.ensure_raw(2025))
    raw = pd.read_parquet(raw_path)
    ftn_path = ROOT / "data/raw/ftn_charting_2025.parquet"
    if not ftn_path.exists():
        response = requests.get(FTN_URL, timeout=45)
        response.raise_for_status()
        ftn_path.write_bytes(response.content)
    college_path = ROOT / "data/raw/teaching-cfbd-2025-oregon-postseason.json"
    if not college_path.exists():
        response = requests.get(CFBD_URL, params=CFBD_PARAMS,
                                headers={"Authorization": "Bearer " + ingest_cfb.load_api_key()}, timeout=30)
        response.raise_for_status()
        college_path.write_text(json.dumps(response.json()))
    payload = build(raw, pd.read_parquet(ftn_path), json.loads(college_path.read_text()))
    path = ROOT / "web/teaching-examples.json"
    path.write_text(json.dumps(payload, indent=2) + "\n")
    audit = {"version": payload["version"], "contentHash": payload["contentHash"],
             "examples": len(payload["examples"]), "practicePairs": len(payload["practice"]),
             "sources": [{"file": str(p.relative_to(ROOT)), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                         for p in [raw_path, ftn_path, college_path, CONTENT]],
             "checks": ["Unique game/play joins and example IDs", "Known, matching FTN fields and season/week",
                        "Exact expected outcomes; no fumbles, interceptions or accepted penalties in NFL examples",
                        "Completed-pass air yards plus after-catch yards equal total gain",
                        "Every practice pair uses a different game"],
             "limitations": ["Selected illustrations, not a representative performance sample",
                             "Practice interprets written evidence; no video recognition or learning gain has been measured",
                             "Only one college worked example; college formation charting is not supplied"]}
    (ROOT / "docs/teaching-examples-audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    print("Wrote {} validated historical lessons to {}".format(len(payload["examples"]), path))


if __name__ == "__main__":
    main()

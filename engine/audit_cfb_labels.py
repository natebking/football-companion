"""Audit exact-game final labels against exported live journals; never score quizzes.

Uses cached /plays snapshots and the production CFBD classifier. It reports
which explicit pre-arrival probability links have an eligible historical label.
These two sessions are a development sample, not a prospective accuracy test.
"""
from collections import Counter
import json
from pathlib import Path
import re
import subprocess

import ingest_cfb
import tendency

ROOT = Path(__file__).resolve().parents[1]


def label(row):
    category, method = ingest_cfb.classify(row.get("playType"), row.get("playText"))
    text = row.get("playText") or ""
    known = row.get("down") in (1, 2, 3, 4) and isinstance(row.get("distance"), int) and row["distance"] >= 1 and isinstance(row.get("yardsToGoal"), int) and 1 <= row["yardsToGoal"] <= 99
    eligible = category in ("pass", "rush") and known and not re.search(tendency.KNEEL_RE, text)
    return {"category": category, "method": method, "eligible": bool(eligible),
            "passLabel": int(category == "pass") if eligible else None}


def audit(game, review, source):
    if source.get("status") != 200 or not isinstance(source.get("payload"), list):
        raise ValueError("A successful cached CFBD /plays response is required")
    rows = [r for r in source["payload"] if str(r.get("gameId")) == game["meta"]["gameId"]]
    counts = Counter(str(r["id"]) for r in rows)
    if any(n != 1 for n in counts.values()):
        raise ValueError("Duplicate final play IDs")
    if review["key"] != game["key"] or review["status"] != "final":
        raise ValueError("The review must be for this exact finished game")
    final = {str(r["id"]): r for r in rows}
    names = {t["id"]: t["shortName"] for t in review["teams"]}
    joined = {}
    rejected = []
    for play in review["plays"]:
        row = final.get(str(play["id"]))
        team = str(play["report"].get("start", {}).get("team", {}).get("id", ""))
        if row and names.get(team) == row.get("offense"):
            joined[str(play["id"])] = row
        else:
            rejected.append(str(play["id"]))
    script = "const fs=require('fs'),j=require('./web/journal.js'),d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(j.compare(d.game,d.review)));"
    result = subprocess.run(["node", "-e", script], cwd=ROOT, input=json.dumps({"game": game, "review": review}),
                            text=True, capture_output=True, check=True)
    comparison = json.loads(result.stdout)
    links = []
    for p in comparison["predictions"]:
        if p["status"] != "linked":
            continue
        row = joined.get(p["playId"])
        links.append({"shownId": p["shownId"], "playId": p["playId"], "label": label(row) if row else None})
    return {"game": game["key"], "finalReportCount": len(review["plays"]), "matchedGamePlayOffense": len(joined),
            "rejectedIds": rejected, "finalLabels": dict(Counter(label(r)["category"] for r in joined.values())),
            "preArrivalProbabilityLinks": len(links), "eligibleSourceAlignedLinks": sum(bool(r["label"] and r["label"]["eligible"]) for r in links),
            "links": links, "source": {k: source[k] for k in ["url", "retrievedAt"]},
            "predictionAccuracyEstablished": False,
            "note": "Final CFBD labels aligned by game, play and offense. These are not independent film labels. No quiz grades, background prompts or final inputs are used as pre-snap predictions."}


def main():
    results = []
    for path in sorted((ROOT / "data/journals").glob("football-journal-cfb-*.json")):
        game = json.loads(path.read_text())
        key = game["key"].replace(":", "-")
        review = json.loads((ROOT / "web/reviews" / (key + ".json")).read_text())
        sources = sorted((ROOT / "data/raw/reviews" / key).glob("cfbd-plays-*.json"))
        if not sources:
            raise ValueError("No cached final /plays source for " + key)
        results.append(audit(game, review, json.loads(sources[-1].read_text())))
    (ROOT / "data/journals/source-label-audit.json").write_text(json.dumps({"schemaVersion": 1, "results": results}, indent=2) + "\n")
    for r in results:
        print(json.dumps({k: r[k] for k in ["game", "matchedGamePlayOffense", "finalReportCount", "preArrivalProbabilityLinks", "eligibleSourceAlignedLinks"]}))


if __name__ == "__main__":
    main()

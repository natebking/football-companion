"""Publish a finished game's factual review; never train on the game being reviewed.

  .venv/bin/python engine/export_game_review.py --game 401858433 --team Oregon --year 2026
  .venv/bin/python engine/export_game_review.py --recent --team Oregon --refresh

Raw responses are timestamped under ignored data/raw/reviews. Public output
contains selected game facts and source attribution, never request headers.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import requests

import ingest_cfb

ROOT = Path(__file__).resolve().parents[1]
ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/college-football"
CFBD = "https://api.collegefootballdata.com"
REPORT_FIELDS = ("id", "sequenceNumber", "type", "text", "awayScore", "homeScore", "period", "clock",
                 "scoringPlay", "modified", "wallclock", "isPenalty", "statYardage", "start", "end",
                 "isTurnover", "pointAfterAttempt", "scoringType", "scoreValue")


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def fetch_cached(name, url, params, directory, refresh=False, key=None):
    expected = {str(k): [str(v)] for k, v in params.items()}
    if not refresh:
        for path in sorted(directory.glob(name + "-*.json"), reverse=True):
            cached = json.loads(path.read_text())
            if cached.get("status") == 200 and parse_qs(urlparse(cached.get("url", "")).query) == expected:
                return cached
    headers = {"Authorization": "Bearer " + key} if key else {}
    response = requests.get(url, params=params, headers=headers, timeout=30)
    try:
        payload = response.json()
    except ValueError:
        payload = None
    result = {"retrievedAt": timestamp(), "url": response.url, "params": params,
              "status": response.status_code, "payload": payload}
    directory.mkdir(parents=True, exist_ok=True)
    name += "-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".json"
    (directory / name).write_text(json.dumps(result))
    return result


def source_info(record, source_id, label):
    return {"id": source_id, "label": label, "url": record["url"], "retrievedAt": record["retrievedAt"],
            "contentSha256": hashlib.sha256(json.dumps(record.get("payload"), sort_keys=True).encode()).hexdigest()}


def final_reports(summary, game_id):
    header = summary.get("header", {})
    if str(header.get("id")) != str(game_id):
        raise ValueError("ESPN returned a different game")
    comp = header.get("competitions", [{}])[0]
    status = comp.get("status", {}).get("type", {})
    if not status.get("completed") or status.get("state") != "post":
        raise ValueError("This game is not final; a finished review was not exported")
    teams = [{"id": str(c["team"]["id"]), "abbreviation": c["team"]["abbreviation"],
              "name": c["team"].get("displayName", c["team"]["abbreviation"]),
              "shortName": c["team"].get("location") or c["team"].get("shortDisplayName") or c["team"]["abbreviation"],
              "homeAway": c.get("homeAway"), "score": c.get("score")} for c in comp.get("competitors", [])]
    drives = summary.get("drives", {})
    groups = list(drives.get("previous", []))
    if drives.get("current"):
        groups.append(drives["current"])
    plays = {}
    for drive in groups:
        for source in drive.get("plays", []):
            if source.get("id") is None:
                continue
            report = {field: source[field] for field in REPORT_FIELDS if field in source}
            play_id = str(source["id"])
            plays[play_id] = {"id": play_id, "driveId": str(drive.get("id", "")), "report": report}
    if not plays:
        raise ValueError("The final response contained no play reports")
    return teams, [dict(play, order=i) for i, play in enumerate(plays.values())]


def describe_reports(plays, teams):
    """Use the live parser's checks instead of implementing a second yardage parser."""
    script = "const fs=require('fs'),p=require('./web/play-facts.js');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(d.plays.map(x=>p.describe(x.report,d.abbr))));"
    data = {"plays": plays, "abbr": {team["id"]: team["abbreviation"] for team in teams}}
    result = subprocess.run(["node", "-e", script], cwd=ROOT, input=json.dumps(data), text=True, capture_output=True, check=True)
    return dict(zip((play["id"] for play in plays), json.loads(result.stdout)))


def joined_rows(record, game_id, plays):
    """One-to-one ID joins only. Similar text or a repeated clock is never a key."""
    rows = record.get("payload") if record.get("status") == 200 else []
    rows = rows if isinstance(rows, list) else []
    same_game = [row for row in rows if str(row.get("gameId")) == str(game_id)]
    counts = Counter(str(row.get("playId")) for row in same_game)
    reports = {play["id"]: play["report"] for play in plays}
    matched = {}
    for row in same_game:
        play_id = str(row.get("playId"))
        report = reports.get(play_id)
        if counts[play_id] != 1 or not report:
            continue
        offense = report.get("start", {}).get("team", {}).get("id")
        if offense is not None and row.get("offenseId") is not None and str(offense) != str(row["offenseId"]):
            continue
        matched[play_id] = row
    return matched, {"received": len(rows), "thisGame": len(same_game), "matched": len(matched),
                     "excluded": len(same_game) - len(matched), "otherGames": len(rows) - len(same_game),
                     "duplicateIds": sum(n > 1 for n in counts.values())}


def integer(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == int(value)


def passing_details(row, facts):
    out = {field: row.get(field) for field in ("passer", "passerId", "target", "targetId", "outcome", "passDepth",
                                              "passDirection", "totalYards", "parseStatus")}
    air, after, total = row.get("airYards"), row.get("yardsAfterCatch"), row.get("totalYards")
    valid = row.get("parseStatus") == "complete" and row.get("outcome") == "completion" and all(integer(n) for n in (air, after, total))
    valid = bool(valid and air + after == total and facts.get("gained") == total and facts.get("outcome") == "pass"
                 and not facts.get("voidReason") and not facts.get("turnover"))
    # If the ESPN catch positions also resolved, a disagreement remains unknown.
    if valid and facts.get("airYards") is not None:
        valid = facts["airYards"] == air and facts.get("yardsAfterCatch") == after
    out.update({"airYards": air if valid else None, "yardsAfterCatch": after if valid else None, "yardageVerified": valid})
    return out


def rushing_details(row, facts):
    total = row.get("rushingYards")
    valid = row.get("parseStatus") == "complete" and integer(total) and facts.get("gained") == total and facts.get("outcome") == "run" and not facts.get("voidReason") and not facts.get("turnover")
    direction = row.get("rushDirection") if row.get("directionAnalysisEligible") and row.get("rushDirection") in ("left", "middle", "right") else None
    return {"rusher": row.get("rusher"), "rusherId": row.get("rusherId"), "rushDirection": direction,
            "rushingYards": total if valid else None, "yardageVerified": bool(valid), "parseStatus": row.get("parseStatus"),
            "isSack": row.get("isSack"), "isKneel": row.get("isKneel"), "isTeamRush": row.get("isTeamRush")}


def build_review(espn, passing, rushing, game_id, described=None):
    if espn.get("status") != 200:
        raise ValueError("The ESPN final report was unavailable")
    summary = espn["payload"]
    teams, plays = final_reports(summary, game_id)
    facts = described if described is not None else describe_reports(plays, teams)
    pass_rows, pass_coverage = joined_rows(passing, game_id, plays)
    rush_rows, rush_coverage = joined_rows(rushing, game_id, plays)
    pass_valid = rush_valid = 0
    for play in plays:
        play_id = play["id"]
        p = passing_details(pass_rows[play_id], facts[play_id]) if play_id in pass_rows else None
        r = rushing_details(rush_rows[play_id], facts[play_id]) if play_id in rush_rows else None
        play["enrichment"] = {"passing": p, "rushing": r}
        play["sourceIds"] = ["espn"] + (["cfbd-passing"] if p else []) + (["cfbd-rushing"] if r else [])
        pass_valid += bool(p and p["yardageVerified"])
        rush_valid += bool(r and r["yardageVerified"])
    notes = ["This review uses finished reports. It does not reconstruct what the live feed said earlier or what the viewer saw.",
             "CollegeFootballData enriches written play reports; these passing and rushing fields are not player-tracking or independent film charting.",
             "Players are joined by game and play ID, with offense checked where available. Clocks are not used to match plays.",
             "Unknown or conflicting yardage stays unknown. Success and EPA/PPA labels are not exposed here. Final reports can still be corrected."]
    sources = [source_info(espn, "espn", "ESPN final play reports")]
    for record, name, coverage in [(passing, "passing", pass_coverage), (rushing, "rushing", rush_coverage)]:
        if record.get("status") == 200:
            sources.append(source_info(record, "cfbd-" + name, "CollegeFootballData " + name + " play details"))
        else:
            notes.append("CollegeFootballData {} was unavailable when this review was checked (HTTP {}).".format(name, record.get("status", "unknown")))
        if coverage["excluded"]:
            notes.append("{} {} rows could not be joined unambiguously and were excluded.".format(coverage["excluded"], name))
    ordered = sorted(teams, key=lambda team: team["homeAway"] == "home")
    label = summary["header"].get("shortName") or summary["header"].get("name") or " at ".join(team["shortName"] for team in ordered)
    return {"schemaVersion": 1, "key": "cfb:" + str(game_id), "league": "cfb", "gameId": str(game_id),
            "label": label, "status": "final", "reviewedAt": timestamp(),
            "teams": teams, "sources": sources, "notes": notes, "plays": plays,
            "coverage": {"espnReports": len(plays), "passing": dict(pass_coverage, verifiedYardage=pass_valid),
                         "rushing": dict(rush_coverage, verifiedYardage=rush_valid)},
            "generator": {"version": 1, "playFactsSha256": hashlib.sha256((ROOT / "web/play-facts.js").read_bytes()).hexdigest()}}


def write_review(review, output):
    output.mkdir(parents=True, exist_ok=True)
    path = output / (review["key"].replace(":", "-") + ".json")
    path.with_suffix(".tmp").write_text(json.dumps(review, ensure_ascii=False, separators=(",", ":")) + "\n")
    path.with_suffix(".tmp").replace(path)
    index_path = output / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {"schemaVersion": 1, "reviews": []}
    entry = {field: review[field] for field in ("key", "league", "gameId", "label", "status", "reviewedAt")}
    entry["path"] = path.name
    index["reviews"] = [old for old in index["reviews"] if old["key"] != review["key"]] + [entry]
    index["reviews"].sort(key=lambda row: row["reviewedAt"], reverse=True)
    index_path.with_suffix(".tmp").write_text(json.dumps(index, indent=2) + "\n")
    index_path.with_suffix(".tmp").replace(index_path)
    return path


def export_one(game_id, team=None, year=None, season_type="regular", refresh=False):
    directory = ROOT / "data/raw/reviews" / ("cfb-" + str(game_id))
    espn = fetch_cached("espn", ESPN + "/summary", {"event": str(game_id)}, directory, refresh)
    teams, _ = final_reports(espn.get("payload") or {}, game_id)
    header = espn["payload"]["header"]
    year = year or header.get("season", {}).get("year")
    if not year:
        raise ValueError("Specify --year because ESPN did not report the season")
    if not team:
        home = next(c for c in header["competitions"][0]["competitors"] if c.get("homeAway") == "home")
        team = home["team"].get("location") or home["team"]["displayName"]
    key = ingest_cfb.load_api_key()
    params = {"year": year, "team": team, "gameId": str(game_id), "seasonType": season_type}
    passing = fetch_cached("cfbd-passing", CFBD + "/passing/plays", params, directory, refresh, key)
    rushing = fetch_cached("cfbd-rushing", CFBD + "/rushing/plays", params, directory, refresh, key)
    review = build_review(espn, passing, rushing, game_id)
    path = write_review(review, ROOT / "web/reviews")
    print(json.dumps({"path": str(path), "key": review["key"], "coverage": review["coverage"]}))
    return review


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", default=None)
    parser.add_argument("--team", default=None)
    parser.add_argument("--year", type=int)
    parser.add_argument("--season-type", choices=["regular", "postseason"], default="regular")
    parser.add_argument("--refresh", action="store_true", help="Fetch new immutable source snapshots")
    parser.add_argument("--recent", action="store_true", help="Find this team's finished game on the requested date")
    parser.add_argument("--date", default=None, help="YYYYMMDD; defaults to today's Eastern date")
    args = parser.parse_args()
    if args.recent:
        if not args.team:
            parser.error("--recent requires --team to keep the refresh bounded")
        date = args.date or datetime.now(ZoneInfo("America/New_York")).strftime("%Y%m%d")
        response = requests.get(ESPN + "/scoreboard", params={"dates": date, "groups": 80, "limit": 1000}, timeout=30)
        response.raise_for_status()
        games = [event["id"] for event in response.json().get("events", []) if event.get("status", {}).get("type", {}).get("completed") and
                 any(args.team.lower() == c.get("team", {}).get("location", "").lower() for c in event.get("competitions", [{}])[0].get("competitors", []))]
        if not games:
            print("No finished game for {} on {}. Existing reviews are unchanged.".format(args.team, date))
    else:
        games = [args.game or "401858433"]
    for game_id in games:
        export_one(game_id, args.team, args.year, args.season_type, args.refresh)


if __name__ == "__main__":
    main()

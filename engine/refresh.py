"""Weekly in-season refresh: ingest the current season, rebuild, re-export.

Binding spec: docs/CONTRACT.md. Runs from `.github/workflows/rebuild-tendencies.yml`
on Tuesday mornings in season, and by hand whenever.

    python engine/refresh.py                      # both leagues, rolling window
    python engine/refresh.py --league cfb
    python engine/refresh.py --seasons 2024 2025 2026
    python engine/refresh.py --dry-run            # ingest, rebuild, write nothing

It owns no logic of its own beyond scheduling. Ingest comes from `ingest_cfb`
and `ingest_nfl`, aggregation from `tendency.build` at its calibrated defaults
(half_life 1.0, SHRINK_K 60), and the shipped bytes from `export_tables.export`
and `export_tables.write`. Changing the numbers means changing those modules,
never this one.

Safe to run repeatedly
----------------------
Every finished CFBD week the cache already holds is read off disk and never
refetched. The one week that is still being played is fetched into a scratch
directory that is deleted on the way out, so a half-finished Saturday can never
enter the durable cache and freeze there. Nothing else in the run has state.

The output files are only written when the numbers move. `generated` changes on
every run by construction, so it is excluded from the comparison; if the rest of
the payload is byte-identical to what is already in `web/`, the file is left
alone and git sees a clean tree. That is what lets the Action decide whether to
commit by asking git, with no extra plumbing.

Season window
-------------
`SEASON_WINDOW = 4`: the season in progress plus the three before it. On the
first automated run that is 2023, 2024, 2025 and 2026, which is exactly the set
CFB already ships plus the live one, so no season currently in the tables is
dropped to make room. With the half-life at 1.0 the fourth season back carries
weight 0.125, so the tail is small by construction. `--seasons` overrides it.

This does move the NFL tables, which ship one season today. Four seasons of
nflverse is more sample under the same shrinkage, not a different method, but it
is a change to shipped numbers and `engine/backtest.py` should be re-run against
it before anyone quotes the contract's NFL Brier as describing the live file.

Which weeks are in play
-----------------------
Finished seasons are fetched as weeks 1-15 plus the single postseason week, the
same shape `ingest_cfb` uses, because they cannot change.

The live season is planned off CFBD's `/calendar`, one call per run, which
returns each week's start and end instant. A week whose end has passed is
finished: fetch it, cache it. The week between its start and its end is in
progress: fetch it, use it, throw the file away. Weeks that have not started are
not requested at all, which is worth about 14 calls a run in September and, more
to the point, means the cache only ever holds weeks that are done.

CFBD budget
-----------
Free tier is 5000 calls a month. The Action starts cold every run because
`data/` is gitignored, so the worst run is the whole window from scratch:

    1 calendar + 16 weeks per season in the window + 1 in-progress week

which is 66 calls at a window of 4. At the Tuesday cadence, 52/12 runs a month,
that is about 286 calls, under 6% of the tier. The run prints its own count and
this projection every time, so the number is measured rather than assumed.
"""
import argparse
import json
import shutil
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_tables  # noqa: E402
import ingest_cfb  # noqa: E402
import ingest_nfl  # noqa: E402
import schema  # noqa: E402
import tendency  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
WEB_DIR = ROOT / "web"

CALENDAR_URL = "https://api.collegefootballdata.com/calendar"
CALENDAR_ATTEMPTS = 4
CALENDAR_TIMEOUT = 60

# The season in progress plus the three before it. See the module docstring.
SEASON_WINDOW = 4

# A season year rolls over in July: the 2026 season runs August 2026 to February
# 2027, so a January run is still refreshing the 2026 season.
SEASON_ROLLOVER_MONTH = 7

FREE_TIER_CALLS = 5000
RUNS_PER_MONTH = 52.0 / 12.0

LEAGUES: Dict[str, Dict[str, str]] = {
    "cfb": {"parquet": "plays_cfb.parquet", "json": "tendency-cfb.json"},
    "nfl": {"parquet": "plays_nfl.parquet", "json": "tendency-nfl.json"},
}


# --------------------------------------------------------------------------- #
# calendar
# --------------------------------------------------------------------------- #
def current_season(now: datetime) -> int:
    return now.year if now.month >= SEASON_ROLLOVER_MONTH else now.year - 1


def season_window(now: datetime, size: int = SEASON_WINDOW) -> List[int]:
    if size < 1:
        raise ValueError("window must be at least 1 season, got {}".format(size))
    latest = current_season(now)
    return list(range(latest - size + 1, latest + 1))


def _instant(text: str) -> datetime:
    """CFBD sends '2026-08-29T07:00:00.000Z'. Parse without depending on 3.11."""
    return datetime.strptime(text[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)


def fetch_calendar(year: int, api_key: str, stats: Dict[str, Any]) -> List[Dict[str, Any]]:
    """CFBD week boundaries for one season. One call, retried on 429 and 5xx."""
    headers = {"Authorization": "Bearer " + api_key, "Accept": "application/json"}
    last = None
    for attempt in range(CALENDAR_ATTEMPTS):
        try:
            resp = requests.get(CALENDAR_URL, params={"year": year}, headers=headers,
                                timeout=CALENDAR_TIMEOUT)
        except requests.RequestException as exc:
            last = "network: {}".format(exc)
            time.sleep(min(2 ** attempt, 30))
            continue
        stats["api_calls"] += 1
        stats["calendar_calls"] += 1
        if resp.status_code == 200:
            rows = resp.json()
            if not isinstance(rows, list) or not rows:
                raise RuntimeError("empty calendar for {}".format(year))
            return rows
        if resp.status_code == 429 or resp.status_code >= 500:
            last = "HTTP {}".format(resp.status_code)
            time.sleep(min(2 ** attempt, 30))
            continue
        raise RuntimeError("CFBD calendar {} for {}: {}".format(
            resp.status_code, year, resp.text[:200]))
    raise RuntimeError("gave up on the {} calendar after {} attempts ({})".format(
        year, CALENDAR_ATTEMPTS, last))


Job = Tuple[int, str, int]  # (source week, seasonType, week as stored)


def _job(week: int, season_type: str) -> Job:
    """Postseason weeks are offset so they sort after the regular season."""
    if season_type == "postseason":
        return week, season_type, ingest_cfb.POSTSEASON_WEEK_OFFSET + week
    return week, season_type, week


def finished_season_jobs() -> List[Job]:
    """Every week of a season that cannot change any more."""
    low, high = ingest_cfb.DEFAULT_WEEKS
    jobs = [_job(w, "regular") for w in range(low, high + 1)]
    jobs.append(_job(ingest_cfb.POSTSEASON_WEEK, "postseason"))
    return jobs


def plan_live_season(calendar: List[Dict[str, Any]], now: datetime) -> Tuple[List[Job], List[Job]]:
    """Split a season's calendar into (finished weeks, the week in progress).

    Finished means the week's end instant has passed, so its play list is final
    and safe to keep. In progress means it has started and has not ended: its
    plays are real but incomplete, so they belong in this run's tables and not
    in the cache. Weeks that have not started are in neither list and cost no
    call at all.
    """
    finished: List[Job] = []
    live: List[Job] = []
    for row in calendar:
        season_type = row.get("seasonType")
        if season_type not in ("regular", "postseason"):
            continue
        job = _job(int(row["week"]), season_type)
        if _instant(row["endDate"]) <= now:
            finished.append(job)
        elif _instant(row["startDate"]) <= now:
            live.append(job)
    return finished, live


# --------------------------------------------------------------------------- #
# ingest
# --------------------------------------------------------------------------- #
def fetch_live_week(year: int, job: Job, classification: str, api_key: str,
                    stats: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fetch a week still being played without letting it reach the cache.

    `ingest_cfb.fetch_week` writes every non-empty response to `data/raw/cfb`
    and never refetches a file that exists, which is exactly right for a
    finished week and exactly wrong for one in progress: on 2026-08-29 week 1
    was 1,224 plays across 7 of its games, and cached in that state it would
    have stood in for the whole week for the rest of the season. Pointing the
    module's cache directory at a scratch dir for the length of the call makes
    that impossible rather than merely unlikely.
    """
    src_week, season_type, _ = job
    original = ingest_cfb.CACHE_DIR
    scratch = Path(tempfile.mkdtemp(prefix="fc-live-week-"))
    try:
        ingest_cfb.CACHE_DIR = scratch
        return ingest_cfb.fetch_week(year, src_week, season_type, classification, api_key, stats)
    finally:
        ingest_cfb.CACHE_DIR = original
        shutil.rmtree(scratch, ignore_errors=True)


def ingest_cfb_frame(seasons: List[int], now: datetime, classification: str,
                     stats: Dict[str, Any]) -> pd.DataFrame:
    api_key = ingest_cfb.load_api_key()
    latest = current_season(now)
    frames = []
    for season in seasons:
        if season >= latest:
            finished, live = plan_live_season(fetch_calendar(season, api_key, stats), now)
        else:
            finished, live = finished_season_jobs(), []

        before = (stats["api_calls"], stats["cache_hits"])
        rows: List[Dict[str, Any]] = []
        for job in finished:
            plays = ingest_cfb.fetch_week(season, job[0], job[1], classification, api_key, stats)
            rows.extend(ingest_cfb.build_rows(plays, season, job[2], stats))
        for job in live:
            plays = fetch_live_week(season, job, classification, api_key, stats)
            stats["live_weeks"] += 1
            rows.extend(ingest_cfb.build_rows(plays, season, job[2], stats))

        frame = ingest_cfb.finalize(rows)
        frames.append(frame)
        print("  cfb {}: {:>6} plays, {:>4} games, {} finished weeks + {} in progress"
              "  (fetched {}, from cache {})".format(
                  season, len(frame), frame["game_id"].nunique() if len(frame) else 0,
                  len(finished), len(live),
                  stats["api_calls"] - before[0], stats["cache_hits"] - before[1]))
    df = pd.concat(frames, ignore_index=True) if frames else schema.empty_frame()
    return schema.conform(df)


def ingest_nfl_frame(seasons: List[int], now: datetime, stats: Dict[str, Any]) -> pd.DataFrame:
    """nflverse rebuilds the live season's release asset, so that one is refetched.

    Finished seasons are immutable and reused from `data/raw` when present. A
    season nflverse has not published yet answers 404, which is the normal state
    of the NFL season between the CFB opener and early September, so it is
    reported and skipped rather than raised.
    """
    latest = current_season(now)
    frames = []
    for season in seasons:
        path = ingest_nfl.raw_path(season)
        if season >= latest and path.exists():
            path.unlink()
            stats["nfl_refetched"] += 1
        cached = path.exists()
        try:
            raw_path = ingest_nfl.ensure_raw(season)
        except requests.HTTPError as exc:
            code = exc.response.status_code if exc.response is not None else "?"
            print("  nfl {}: nflverse has not published this season yet (HTTP {}), skipped".format(
                season, code))
            stats["nfl_missing"].append(season)
            continue
        if not cached:
            stats["nfl_downloads"] += 1
        raw = pd.read_parquet(raw_path, columns=ingest_nfl.SOURCE_COLUMNS)
        frame = ingest_nfl.transform(raw)
        frames.append(frame)
        print("  nfl {}: {:>6} plays, {:>4} games  ({})".format(
            season, len(frame), frame["game_id"].nunique(),
            "from cache" if cached else "downloaded"))
    if not frames:
        raise RuntimeError("no NFL seasons available in window {}".format(seasons))
    return schema.conform(pd.concat(frames, ignore_index=True))


# --------------------------------------------------------------------------- #
# rebuild and export
# --------------------------------------------------------------------------- #
def present_seasons(df: pd.DataFrame, wanted: List[int]) -> List[int]:
    """The requested seasons that actually arrived with plays behind them."""
    have = {int(s) for s in pd.to_numeric(df["season"], errors="coerce").dropna().unique()}
    got = sorted(have & set(wanted))
    if not got:
        raise RuntimeError("no plays for any season in {}".format(wanted))
    return got


def _payload_without_generated(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in payload.items() if k != "generated"}


def _read_shipped(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return None


def rebuild(league: str, df: pd.DataFrame, seasons: List[int], generated: str,
            dry_run: bool) -> Dict[str, Any]:
    """Aggregate, export, and write only if the numbers moved."""
    out = WEB_DIR / LEAGUES[league]["json"]
    tables = tendency.build(df, seasons=seasons)
    payload, report = export_tables.export(tables, generated=generated)

    previous = _read_shipped(out)
    if previous is None:
        reason = "no previous file on disk"
        changed = True
    else:
        changed = _payload_without_generated(previous) != _payload_without_generated(payload)
        reason = "numbers moved" if changed else "identical to what is already shipped"

    written = None
    if changed and not dry_run:
        written = export_tables.write(payload, out)

    print("  {}: {} eligible plays, {} teams, seasons {}".format(
        out.name, tables["plays"], len(tables["teams"]), payload["seasons"]))
    print("    shrink_k {}   half_life {}   min_sample {}".format(
        tables["shrink_k"], tables["half_life"], tables["min_sample"]))
    print("    teams shipped {}   team cells {}   attributable {}   baseline buckets {}".format(
        report["teams"], report["team_entries"], report["attributable_entries"],
        report["baseline_buckets"]))
    print("    {:,} bytes on disk, {:,} gzipped (budget {:,}, under: {})".format(
        report["bytes"], report["gzip"], report["budget"],
        report["gzip"] <= report["budget"]))
    print("    {}: {}".format("CHANGED" if changed else "unchanged", reason))
    if changed and dry_run:
        print("    dry run, {} not written".format(out.name))
    elif changed:
        print("    wrote {} ({:,} bytes)".format(out.name, written))
    return {"league": league, "changed": changed, "path": out, "bytes": report["bytes"],
            "plays": tables["plays"], "teams": len(tables["teams"]), "report": report}


# --------------------------------------------------------------------------- #
# cost
# --------------------------------------------------------------------------- #
def worst_case_calls(window: int) -> int:
    """Every call a cold run can make: calendar, the window, the live week."""
    low, high = ingest_cfb.DEFAULT_WEEKS
    weeks_per_season = (high - low + 1) + 1  # regular weeks plus the postseason week
    return 1 + weeks_per_season * window + 1


def report_cost(stats: Dict[str, Any], window: int) -> None:
    calls = stats["api_calls"]
    worst = worst_case_calls(window)
    print()
    print("CFBD API calls this run: {}".format(calls))
    print("  calendar:                    {}".format(stats["calendar_calls"]))
    print("  weeks read from local cache: {}  (cost nothing)".format(stats["cache_hits"]))
    print("  in-progress weeks fetched:   {}  (never cached, refetched every run)".format(
        stats["live_weeks"]))
    print("  weeks CFBD returned empty:   {}".format(stats["empty_weeks"]))
    print("nflverse downloads this run: {}  (not CFBD, no quota)".format(stats["nfl_downloads"]))
    print()
    print("Monthly cost at the Tuesday cadence ({:.2f} runs/month), free tier {}:".format(
        RUNS_PER_MONTH, FREE_TIER_CALLS))
    print("  this run repeated:      {:>6.0f} calls/month  ({:.1f}% of the tier)".format(
        calls * RUNS_PER_MONTH, 100.0 * calls * RUNS_PER_MONTH / FREE_TIER_CALLS))
    print("  cold every run, {} seasons: {:>3} calls/run -> {:.0f} calls/month  ({:.1f}% of the tier)".format(
        window, worst, worst * RUNS_PER_MONTH, 100.0 * worst * RUNS_PER_MONTH / FREE_TIER_CALLS))
    print("  fits the free tier: {}".format(worst * RUNS_PER_MONTH < FREE_TIER_CALLS))


# --------------------------------------------------------------------------- #
def new_stats() -> Dict[str, Any]:
    from collections import Counter
    return {"api_calls": 0, "cache_hits": 0, "empty_weeks": 0, "calendar_calls": 0,
            "live_weeks": 0, "nfl_downloads": 0, "nfl_refetched": 0, "nfl_missing": [],
            "duplicates": 0, "clamped_yards": 0, "seen": set(), "type_counts": Counter(),
            "type_category": Counter(), "dropped": Counter()}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--league", choices=["cfb", "nfl", "both"], default="both")
    parser.add_argument("--seasons", type=int, nargs="+", default=None,
                        help="override the rolling window, e.g. --seasons 2024 2025 2026")
    parser.add_argument("--window", type=int, default=SEASON_WINDOW,
                        help="how many seasons the rolling window holds (default {})".format(
                            SEASON_WINDOW))
    parser.add_argument("--classification", default="fbs",
                        help="CFBD division filter; 'all' fetches every division")
    parser.add_argument("--dry-run", action="store_true",
                        help="ingest and rebuild, write nothing")
    parser.add_argument("--no-parquet", action="store_true",
                        help="skip writing data/plays_*.parquet")
    parser.add_argument("--now", default=None,
                        help="pretend the run happened at this UTC instant, e.g. 2026-10-07T12:00:00")
    args = parser.parse_args(argv)

    now = (datetime.now(timezone.utc) if args.now is None
           else _instant(args.now if len(args.now) >= 19 else args.now + "T00:00:00"))
    seasons = sorted(args.seasons) if args.seasons else season_window(now, args.window)
    window = len(seasons)
    leagues = list(LEAGUES) if args.league == "both" else [args.league]
    generated = now.date().isoformat()
    stats = new_stats()

    print("=" * 96)
    print("refresh at {}   season in progress: {}   window: {}".format(
        now.replace(microsecond=0).isoformat(), current_season(now), seasons))
    print("  leagues {}   dry run {}   classification {}".format(leagues, args.dry_run,
                                                                 args.classification))
    print("-" * 96)

    results = []
    for league in leagues:
        print("ingest {}".format(league))
        if league == "cfb":
            df = ingest_cfb_frame(seasons, now, "" if args.classification == "all"
                                  else args.classification, stats)
        else:
            df = ingest_nfl_frame(seasons, now, stats)
        print("  {} total: {} plays, validate(): {}".format(league, len(df), schema.validate(df)))
        if not args.no_parquet and not args.dry_run:
            written = schema.write_plays(df, DATA_DIR / LEAGUES[league]["parquet"])
            print("  wrote {} ({:.1f} MB)".format(written, Path(written).stat().st_size / 1e6))
        # The window is what we asked for; the tables may only claim what arrived.
        # nflverse has not cut a 2026 release yet, and a file that says it covers
        # a season holding zero plays is a lie the client cannot detect. Dropping
        # the absent season does not move a single rate: the recency weight is
        # 0.5 ** ((max(seasons) - season) / half_life) and the rates are weighted
        # means, so rescaling every weight by the same factor cancels.
        have = present_seasons(df, seasons)
        if have != seasons:
            print("  seasons with no plays in the frame, dropped from the tables: {}".format(
                [s for s in seasons if s not in have]))
        print("rebuild {}".format(league))
        results.append(rebuild(league, df, have, generated, args.dry_run))
        print("-" * 96)

    report_cost(stats, window)
    if stats["nfl_missing"]:
        print("nflverse seasons not published yet, skipped: {}".format(stats["nfl_missing"]))
    print()
    changed = [r["league"] for r in results if r["changed"]]
    print("files rewritten: {}".format(
        ", ".join(str(r["path"]) for r in results if r["changed"]) or "none"))
    print("RESULT: {}".format("changed " + ",".join(changed) if changed else "no change"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

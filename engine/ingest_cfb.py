"""CollegeFootballData play-by-play -> unified schema -> data/plays_cfb.parquet.

Contract: docs/CONTRACT.md, "Unified play schema". Imports engine/schema.py for
dtypes, success, validation and IO. Owns nothing else.

Network policy
--------------
One GET per (year, week, seasonType). Every response is cached to
``data/raw/cfb/{year}_w{week}.json`` and a file that exists is never refetched,
because the free CFBD tier allows 5000 calls per month. Requests are throttled
to two per second and retried with exponential backoff on 429 and 5xx.

Usage
-----
    python engine/ingest_cfb.py                       # seasons 2023 2024 2025
    python engine/ingest_cfb.py --seasons 2025
    python engine/ingest_cfb.py --teams USC UCLA
    python engine/ingest_cfb.py --seasons 2024 --weeks 1-4 --out /tmp/x.parquet
"""
import argparse
import json
import os
import re
import sys
import time
from collections import Counter, OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import schema  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / "data" / "raw" / "cfb"
OUT_PATH = ROOT / "data" / "plays_cfb.parquet"
API_URL = "https://api.collegefootballdata.com/plays"

DEFAULT_SEASONS = (2023, 2024, 2025)
DEFAULT_WEEKS = (1, 15)
POSTSEASON_WEEK = 1          # CFBD packs the whole bowl slate into postseason week 1
POSTSEASON_WEEK_OFFSET = 15  # so postseason sorts after the regular season

MIN_INTERVAL = 0.5   # seconds between requests, i.e. 2 rps
MAX_ATTEMPTS = 6
REQUEST_TIMEOUT = 300

# --------------------------------------------------------------------------
# play type classification
#
# Every distinct CFBD ``playType`` maps to exactly one category. Categories:
#   pass / rush     scrimmage plays, counted in tendency
#   special         kickoff, punt, FG, PAT, two-point try; kept, excluded
#   penalty         no-play penalty rows; kept, excluded
#   admin           clock administration, not a play at all; dropped
#   text            outcome-named types whose call is only in playText; resolved
# A playType absent from this table is resolved from text and reported loudly.
# --------------------------------------------------------------------------
PLAY_TYPE_CLASS = OrderedDict([
    ("Pass Reception", "pass"),
    ("Pass Incompletion", "pass"),
    ("Pass Completion", "pass"),
    ("Passing Touchdown", "pass"),
    ("Sack", "pass"),
    ("Interception", "pass"),
    ("Pass Interception", "pass"),
    ("Pass Interception Return", "pass"),
    ("Interception Return Touchdown", "pass"),
    ("Pass Incompletion Return", "pass"),

    ("Rush", "rush"),
    ("Rushing Touchdown", "rush"),

    ("Kickoff", "special"),
    ("Kickoff Return (Offense)", "special"),
    ("Kickoff Return (Defense)", "special"),
    ("Kickoff Return Touchdown", "special"),
    ("Kickoff Team Fumble Recovery", "special"),
    ("Kickoff Team Fumble Recovery Touchdown", "special"),
    ("Punt", "special"),
    ("Punt Return", "special"),
    ("Punt Return Touchdown", "special"),
    ("Punt Team Fumble Recovery", "special"),
    ("Punt Team Fumble Recovery Touchdown", "special"),
    ("Blocked Punt", "special"),
    ("Blocked Punt Touchdown", "special"),
    ("Blocked Punt Return Touchdown", "special"),
    ("Field Goal Good", "special"),
    ("Field Goal Missed", "special"),
    ("Blocked Field Goal", "special"),
    ("Blocked Field Goal Touchdown", "special"),
    ("Missed Field Goal Return", "special"),
    ("Missed Field Goal Return Touchdown", "special"),
    ("Extra Point Good", "special"),
    ("Extra Point Missed", "special"),
    ("Two Point Pass", "special"),
    ("Two Point Rush", "special"),
    ("Two Point Conversion Good", "special"),
    ("Two Point Conversion Missed", "special"),
    ("Defensive 2pt Conversion", "special"),

    ("Penalty", "penalty"),

    ("Timeout", "admin"),
    ("End Period", "admin"),
    ("End of Half", "admin"),
    ("End of Game", "admin"),
    ("End of Regulation", "admin"),
    ("Start of Period", "admin"),
    ("Coin Toss", "admin"),
    ("placeholder", "admin"),

    ("Fumble", "text"),
    ("Fumble Recovery (Own)", "text"),
    ("Fumble Recovery (Opponent)", "text"),
    ("Fumble Return Touchdown", "text"),
    ("Safety", "text"),
    ("Offensive 1pt Safety", "text"),
    ("Uncategorized", "text"),
])

# Types with a fabricated down/distance in the source (the ball is not snapped
# from a line of scrimmage). Contract: down is null on kickoffs and PATs.
NO_DOWN_TYPES = frozenset(
    t for t in PLAY_TYPE_CLASS
    if PLAY_TYPE_CLASS[t] == "special"
    and ("Kickoff" in t or "Extra Point" in t or "Two Point" in t or "2pt" in t)
)

# playText resolution, used only for the "text" category and unknown types.
# The trailing PAT parenthetical is stripped first so "(Trey Smack Kick)" cannot
# make a fumble return look like special teams.
_PAT_PARENS = re.compile(r"\([^)]*\bkick\b[^)]*\)", re.I)
_TEXT_PATTERNS = (
    ("pass", re.compile(r"pass(?:es|ed)?\b|sack(?:ed)?\b|incomplete|intercept", re.I)),
    ("rush", re.compile(r"\bruns?\b|\brush(?:ed|es)?\b|\bkneel(?:s|ed|ing)?\b|\bkeeper\b|\bscrambl(?:e|es|ed|ing)\b", re.I)),
    ("special", re.compile(r"kickoff|\bpunt|field goal|\bkicks?\b|\bfg\b|extra point|onside", re.I)),
)


def resolve_from_text(play_text: Optional[str]) -> Optional[str]:
    """Classify by whichever category verb appears first in the description."""
    s = _PAT_PARENS.sub(" ", play_text or "")
    hits = []
    for cat, pat in _TEXT_PATTERNS:
        m = pat.search(s)
        if m:
            hits.append((m.start(), cat))
    return min(hits)[1] if hits else None


def classify(play_type: Optional[str], play_text: Optional[str]) -> Tuple[str, str]:
    """Return (category, how). Category is pass/rush/special/penalty/drop."""
    play_text = re.split(r"\bOriginal Play:", play_text or "", maxsplit=1, flags=re.I)[0]
    if re.search(r"\bno play\b|\bnullified\b", play_text or "", re.I):
        return "penalty", "explicit-no-play"
    known = PLAY_TYPE_CLASS.get(play_type or "")
    if known in ("pass", "rush", "special", "penalty"):
        return known, "table"
    if known == "admin":
        return "drop", "admin"
    resolved = resolve_from_text(play_text)
    how = "text" if known == "text" else "unknown-type-text"
    if resolved is None:
        return "drop", "unresolved" if known == "text" else "unknown-type-unresolved"
    return resolved, how


# --------------------------------------------------------------------------
# fetching
# --------------------------------------------------------------------------
def load_api_key() -> str:
    """CFBD_API_KEY from the environment, else from .env. Never logged."""
    key = os.environ.get("CFBD_API_KEY")
    if key:
        return key.strip()
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            if name.strip() == "CFBD_API_KEY":
                return value.strip().strip('"').strip("'")
    raise RuntimeError("CFBD_API_KEY not found in environment or {}".format(env_path))


_last_call = [0.0]


def _throttle() -> None:
    wait = MIN_INTERVAL - (time.monotonic() - _last_call[0])
    if wait > 0:
        time.sleep(wait)
    _last_call[0] = time.monotonic()


def cache_path(year: int, week: int, season_type: str, classification: str) -> Path:
    stem = "{}_w{}".format(year, week) if season_type == "regular" else "{}_post_w{}".format(year, week)
    if classification != "fbs":
        stem += "_" + classification
    return CACHE_DIR / (stem + ".json")


def fetch_week(year: int, week: int, season_type: str, classification: str,
               api_key: str, stats: Dict[str, int]) -> List[Dict[str, Any]]:
    """Cached GET. Returns the play list. Empty responses are not cached."""
    path = cache_path(year, week, season_type, classification)
    if path.exists():
        stats["cache_hits"] += 1
        return json.loads(path.read_text())

    params = {"year": year, "week": week, "seasonType": season_type}
    if classification:
        params["classification"] = classification
    headers = {"Authorization": "Bearer " + api_key, "Accept": "application/json"}

    last_err = None
    for attempt in range(MAX_ATTEMPTS):
        _throttle()
        try:
            resp = requests.get(API_URL, params=params, headers=headers, timeout=REQUEST_TIMEOUT)
        except requests.RequestException as exc:
            last_err = "network: {}".format(exc)
            time.sleep(min(2 ** attempt, 30))
            continue
        stats["api_calls"] += 1
        if resp.status_code == 200:
            plays = resp.json()
            if not isinstance(plays, list):
                raise RuntimeError("unexpected payload for {} w{} {}".format(year, week, season_type))
            if plays:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(plays, separators=(",", ":")))
            else:
                stats["empty_weeks"] += 1
            return plays
        if resp.status_code == 429 or resp.status_code >= 500:
            retry_after = resp.headers.get("Retry-After")
            delay = float(retry_after) if retry_after and retry_after.isdigit() else min(2 ** attempt, 30)
            last_err = "HTTP {}".format(resp.status_code)
            print("  retry {} w{} {}: {}, sleeping {:.0f}s".format(year, week, season_type, last_err, delay))
            time.sleep(delay)
            continue
        raise RuntimeError("CFBD {} for {} w{} {}: {}".format(
            resp.status_code, year, week, season_type, resp.text[:200]))
    raise RuntimeError("gave up on {} w{} {} after {} attempts ({})".format(
        year, week, season_type, MAX_ATTEMPTS, last_err))


# --------------------------------------------------------------------------
# row building
# --------------------------------------------------------------------------
def _int_or_none(value: Any, lo: int, hi: int) -> Optional[int]:
    """None outside the contract range, so a fabricated value never lands as data."""
    if value is None:
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def _clock_seconds(clock: Any) -> Optional[int]:
    if not isinstance(clock, dict):
        return None
    minutes, seconds = clock.get("minutes"), clock.get("seconds")
    if minutes is None and seconds is None:
        return None
    total = int(minutes or 0) * 60 + int(seconds or 0)
    return total if 0 <= total <= 900 else None


def text_clock(play_text: Optional[str]) -> Optional[int]:
    """Explicit snap clock at the start of a report; never a later clock mention.

    The structured CFBD clock can describe the end of the play in 2025+.
    Earlier reports often omit the leading clock, so absence stays unknown here.
    """
    match = re.match(r"^\s*\((\d{1,2}):(\d{2})\)", play_text if isinstance(play_text, str) else "")
    if not match:
        return None
    minutes, seconds = map(int, match.groups())
    total = minutes * 60 + seconds
    return total if seconds < 60 and total <= 900 else None


def build_rows(plays: List[Dict[str, Any]], season: int, week: int,
               stats: Dict[str, Any]) -> List[Dict[str, Any]]:
    """One dict per surviving play. Ordering keys and raw scores ride along."""
    rows = []
    for play in plays:
        play_type = play.get("playType")
        play_text = play.get("playText")
        stats["type_counts"][play_type] += 1

        key = (play.get("gameId"), play.get("period"), _clock_seconds(play.get("clock")),
               play_type, play_text, play.get("down"), play.get("distance"), play.get("yardsToGoal"))
        if key in stats["seen"]:
            stats["duplicates"] += 1
            continue
        stats["seen"].add(key)

        category, how = classify(play_type, play_text)
        stats["type_category"][(play_type, category, how)] += 1
        if category == "drop":
            stats["dropped"][play_type] += 1
            continue

        no_down = play_type in NO_DOWN_TYPES
        down = None if no_down else _int_or_none(play.get("down"), 1, 4)
        distance = None if no_down else _int_or_none(play.get("distance"), 0, 99)

        gained = play.get("yardsGained")
        if gained is None:
            yards_gained = None
        else:
            yards_gained = max(-99, min(99, int(gained)))
            if int(gained) != yards_gained:
                stats["clamped_yards"] += 1

        snap_clock = text_clock(play_text)
        rows.append({
            "league": "cfb",
            "season": season,
            "week": week,
            "game_id": str(play.get("gameId")),
            "play_id": str(play.get("id")),
            "offense": play.get("offense"),
            "defense": play.get("defense"),
            "period": play.get("period"),
            "clock_seconds": snap_clock if snap_clock is not None else _clock_seconds(play.get("clock")),
            "down": down,
            "distance": distance,
            "yards_to_goal": _int_or_none(play.get("yardsToGoal"), 1, 99),
            "play_type_raw": play_type,
            "is_pass": category == "pass",
            "is_rush": category == "rush",
            "is_special": category == "special",
            "is_penalty_only": category == "penalty",
            "yards_gained": yards_gained,
            "value": play.get("ppa"),
            "play_text": play_text,
            "_drive": play.get("driveNumber"),
            "_play_no": play.get("playNumber"),
            "_home": play.get("home"),
            "_off_score": play.get("offenseScore"),
            "_def_score": play.get("defenseScore"),
        })
    return rows


def finalize(rows: List[Dict[str, Any]]) -> pd.DataFrame:
    """Order plays, index them, derive pre-snap score_diff and success, conform."""
    df = pd.DataFrame(rows)
    if df.empty:
        return schema.empty_frame()

    # (driveNumber, playNumber) is a total order inside a game: verified unique,
    # period-monotonic and clock-monotonic on the 2023 and 2025 samples.
    df = df.sort_values(["season", "week", "game_id", "_drive", "_play_no"], kind="mergesort")
    df = df.reset_index(drop=True)
    df["play_index"] = df.groupby("game_id", sort=False).cumcount()

    # CFBD scores are POST-play, the contract wants pre-snap. Convert to absolute
    # home/away, shift one play inside the game, convert back to offense/defense.
    off_is_home = df["offense"] == df["_home"]
    home_post = df["_off_score"].where(off_is_home, df["_def_score"])
    away_post = df["_def_score"].where(off_is_home, df["_off_score"])
    grouped = pd.DataFrame({"game_id": df["game_id"], "h": home_post, "a": away_post})
    home_pre = grouped.groupby("game_id", sort=False)["h"].shift(1).fillna(0)
    away_pre = grouped.groupby("game_id", sort=False)["a"].shift(1).fillna(0)
    df["score_diff"] = (home_pre - away_pre).where(off_is_home, away_pre - home_pre)
    df["score_diff"] = df["score_diff"].clip(-99, 99)

    df["success"] = schema.success_flag(df["down"], df["distance"], df["yards_gained"])
    return schema.conform(df[schema.COLUMN_NAMES])


# --------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------
def classification_table(stats: Dict[str, Any]) -> str:
    """Every distinct playType, every category it produced, and how it got there.

    A type resolved from text can split across categories, so each split is its
    own line. Nothing is summarised away: an unclassified type cannot hide here.
    """
    by_type = {}
    for (play_type, category, how), count in stats["type_category"].items():
        by_type.setdefault(play_type, []).append((count, category, how))
    lines = ["{:<38s} {:>8s}  {:<9s} {}".format("playType", "count", "category", "source"),
             "-" * 76]
    for play_type, total in stats["type_counts"].most_common():
        splits = sorted(by_type.get(play_type, []), reverse=True)
        kept = sum(c for c, _, _ in splits)
        if len(splits) == 1 and kept == total:
            count, category, how = splits[0]
            lines.append("{:<38s} {:>8d}  {:<9s} {}".format(
                str(play_type), total, "DROPPED" if category == "drop" else category, how))
            continue
        note = "" if kept == total else "  ({} duplicate rows removed)".format(total - kept)
        lines.append("{:<38s} {:>8d}{}".format(str(play_type), total, note))
        for count, category, how in splits:
            lines.append("  {:<36s} {:>8d}  {:<9s} {}".format(
                "->", count, "DROPPED" if category == "drop" else category, how))
    return "\n".join(lines)


def sanity(df: pd.DataFrame) -> str:
    elig = df[~(df["is_special"] | df["is_penalty_only"])]
    out = []
    for label, mask in (
        ("3rd and long (8+)", (elig["down"] == 3) & (elig["distance"] >= 8)),
        ("3rd and short (1-3)", (elig["down"] == 3) & (elig["distance"] <= 3)),
        ("1st and 10", (elig["down"] == 1) & (elig["distance"] == 10)),
        ("2nd and long (8+)", (elig["down"] == 2) & (elig["distance"] >= 8)),
        ("4th down", elig["down"] == 4),
    ):
        sub = elig[mask.fillna(False)]
        rate = float(sub["is_pass"].mean()) if len(sub) else float("nan")
        out.append("  {:<22s} n={:>7d}  pass_rate={:.4f}".format(label, len(sub), rate))
    out.append("  (is_pass is the play as executed. CFBD codes QB scrambles as 'Rush' and")
    out.append("   gives no scramble marker, so these rates sit below the equivalent NFL ones.)")
    return "\n".join(out)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Ingest CFBD play-by-play into the unified schema.")
    parser.add_argument("--seasons", type=int, nargs="+", default=list(DEFAULT_SEASONS))
    parser.add_argument("--teams", nargs="+", default=None,
                        help="keep only plays where this team is on offense or defense")
    parser.add_argument("--weeks", default="{}-{}".format(*DEFAULT_WEEKS),
                        help="regular season week range, e.g. 1-15")
    parser.add_argument("--classification", default="fbs",
                        help="CFBD division filter; 'all' fetches every division")
    parser.add_argument("--no-postseason", action="store_true")
    parser.add_argument("--out", default=str(OUT_PATH))
    args = parser.parse_args(argv)

    lo, _, hi = args.weeks.partition("-")
    weeks = range(int(lo), int(hi or lo) + 1)
    classification = "" if args.classification == "all" else args.classification
    api_key = load_api_key()

    stats = {"api_calls": 0, "cache_hits": 0, "empty_weeks": 0, "duplicates": 0,
             "clamped_yards": 0, "seen": set(), "type_counts": Counter(),
             "type_category": Counter(), "dropped": Counter()}

    frames = []
    per_season = []
    for season in args.seasons:
        rows: List[Dict[str, Any]] = []
        jobs = [(w, "regular", w) for w in weeks]
        if not args.no_postseason:
            jobs.append((POSTSEASON_WEEK, "postseason", POSTSEASON_WEEK_OFFSET + POSTSEASON_WEEK))
        for src_week, season_type, out_week in jobs:
            plays = fetch_week(season, src_week, season_type, classification, api_key, stats)
            rows.extend(build_rows(plays, season, out_week, stats))
        frame = finalize(rows)
        frames.append(frame)
        per_season.append((season, len(frame), int(frame["game_id"].nunique())))
        print("season {}: {} rows, {} games".format(season, len(frame), frame["game_id"].nunique()))

    df = pd.concat(frames, ignore_index=True) if frames else schema.empty_frame()
    if args.teams:
        wanted = set(args.teams)
        df = df[df["offense"].isin(wanted) | df["defense"].isin(wanted)].reset_index(drop=True)
        print("team filter {}: {} rows".format(sorted(wanted), len(df)))
    df = schema.conform(df)

    print()
    print("api calls this run: {}   cache hits: {}   empty weeks: {}".format(
        stats["api_calls"], stats["cache_hits"], stats["empty_weeks"]))
    print("duplicate source rows removed: {}".format(stats["duplicates"]))
    print("yards_gained clamped to +/-99: {}".format(stats["clamped_yards"]))
    print("dropped rows by playType: {}".format(dict(stats["dropped"].most_common())))
    print()
    print(classification_table(stats))
    print()
    print("rows per season: {}".format([(s, n, "games={}".format(g)) for s, n, g in per_season]))
    print()
    print("validate(): {}".format(schema.validate(df)))
    print()
    print("pass rate sanity (scrimmage plays only):")
    print(sanity(df))
    print()
    print("wrote: {}".format(schema.write_plays(df, args.out)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

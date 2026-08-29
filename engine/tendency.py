"""Situational tendency tables and the fallback ladder.

Binding spec: docs/CONTRACT.md, "Tendency query and fallback ladder".

`build()` reduces a unified play frame to five lookup tables, one per rung of the
ladder. `query()` walks them until a rung carries `sample_size >= 30`. One code
path serves both leagues; the league lives in the tables, not in the code.

Recency weighting is exponential by season with a one-season half-life: the most
recent requested season weighs 1.0, the one before it 0.5, and so on. The weights
move the *rates*. `sample_size` stays the raw play count, because it is what
gates confidence and a weighted count would let three-year-old plays buy
confidence they have not earned.
"""
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import buckets  # noqa: E402

MIN_SAMPLE = 30
EXPLOSIVE_PASS_YARDS = 15
EXPLOSIVE_RUSH_YARDS = 10
RUNG_CONFIDENCE: Dict[int, str] = {1: "high", 2: "high", 3: "medium", 4: "medium", 5: "low"}

# Clock-killing snaps. They carry a down and distance but no call, so they belong
# in no tendency denominator. nflverse tags them as their own play_type and the
# ingester leaves them with all four category flags false, so `is_pass | is_rush`
# already drops them; CFBD codes them as ordinary rushes and only the text says so.
KNEEL_RE = r"(?i)\b(?:kneels|kneel down|takes a knee)\b"

_SUMS = ["n", "w_n", "w_pass", "w_success", "w_explosive"]


def eligible(df: pd.DataFrame) -> pd.DataFrame:
    """Rows that are a called pass or run in a situation the contract can bucket.

    Drops, in order: special teams and no-play penalties (the contract's own
    exclusion), anything that is neither a pass nor a rush (kneels, spikes), any
    row missing down, distance, or field position, and clock-killing kneels that
    the source classified as runs.
    """
    is_pass = df["is_pass"].astype(bool)
    is_rush = df["is_rush"].astype(bool)
    keep = (is_pass | is_rush) & ~(df["is_special"].astype(bool) | df["is_penalty_only"].astype(bool))
    keep &= df["down"].notna() & df["distance"].notna() & df["yards_to_goal"].notna()
    keep &= ~df["play_text"].fillna("").str.contains(KNEEL_RE, regex=True)
    return df[keep]


def build(df: pd.DataFrame, seasons: Optional[Iterable[int]] = None,
          half_life: float = 1.0) -> Dict[str, Any]:
    """Aggregate a unified play frame into the five ladder tables.

    `seasons` is the recent window that rungs 1 to 3 and the league baseline use,
    season-decayed. Rung 4 deliberately ignores it and pools every season in `df`
    unweighted, which is the contract's "team, all seasons" rung. Defaults to
    every season present.
    """
    if half_life <= 0:
        raise ValueError("half_life must be positive, got {}".format(half_life))
    el = eligible(df)
    if el.empty:
        raise ValueError("no eligible plays in frame of {} rows".format(len(df)))
    leagues = sorted(el["league"].dropna().unique().tolist())
    if len(leagues) != 1:
        raise ValueError("build() takes one league at a time, found {}".format(leagues))

    all_seasons = sorted(int(s) for s in el["season"].dropna().unique())
    seasons = sorted({int(s) for s in (all_seasons if seasons is None else seasons)})
    if not seasons:
        raise ValueError("seasons is empty")

    yards = pd.to_numeric(el["yards_gained"], errors="coerce")
    is_pass = el["is_pass"].astype(bool)
    is_rush = el["is_rush"].astype(bool)
    explosive = ((is_pass & (yards >= EXPLOSIVE_PASS_YARDS)) |
                 (is_rush & (yards >= EXPLOSIVE_RUSH_YARDS)))
    fine = pd.DataFrame({
        "team": el["offense"].astype(str),
        "down": pd.to_numeric(el["down"]).astype(int),
        "band": buckets.distance_band_series(el["distance"]),
        "zone": buckets.field_zone_series(el["yards_to_goal"]),
        "season": pd.to_numeric(el["season"]).astype(int),
        "n": 1,
        "n_pass": is_pass.astype(int),
        "n_success": el["success"].astype(bool).astype(int),
        "n_explosive": explosive.astype(int),
    }).groupby(["team", "down", "band", "zone", "season"], as_index=False).sum()

    recent = fine[fine["season"].isin(seasons)].copy()
    if recent.empty:
        raise ValueError("no plays in seasons {}, frame has {}".format(seasons, all_seasons))
    recent["w"] = 0.5 ** ((max(seasons) - recent["season"]) / float(half_life))
    recent["w_n"] = recent["n"] * recent["w"]
    for src, dst in (("n_pass", "w_pass"), ("n_success", "w_success"), ("n_explosive", "w_explosive")):
        recent[dst] = recent[src] * recent["w"]

    # Rung 1: exact bucket, team, recent seasons.
    ex = recent.groupby(["team", "down", "band", "zone"], as_index=False)[_SUMS].sum()
    ex["key"] = _exact_key(ex)

    # Rung 2: same down and distance band, field zone pooled with its neighbours.
    # Adjacency is symmetric, so a source row in zone z feeds exactly the target
    # zones in neighbors(z).
    zmap = pd.DataFrame([(z, t) for z in buckets.FIELD_ZONES for t in buckets.zone_neighbors(z)],
                        columns=["zone", "tzone"])
    po = recent.merge(zmap, on="zone")
    po = (po.groupby(["team", "down", "band", "tzone"], as_index=False)[_SUMS].sum()
            .rename(columns={"tzone": "zone"}))
    po["key"] = _exact_key(po)  # keyed by the zone asked for, matched over its neighbours

    # Rung 3: down and distance band only, team, recent seasons.
    dd = recent.groupby(["team", "down", "band"], as_index=False)[_SUMS].sum()
    dd["key"] = "d" + dd["down"].astype(str) + "_" + dd["band"]

    # Rung 4: down only, team, every season, unweighted.
    flat = fine.rename(columns={"n_pass": "w_pass", "n_success": "w_success",
                                "n_explosive": "w_explosive"})
    flat = flat.assign(w_n=flat["n"])
    dn = flat.groupby(["team", "down"], as_index=False)[_SUMS].sum()
    dn["key"] = "d" + dn["down"].astype(str)

    # Rung 5: league average, exact bucket, recent seasons.
    lg = recent.groupby(["down", "band", "zone"], as_index=False)[_SUMS].sum()
    lg["key"] = _exact_key(lg)

    return {
        "league": leagues[0],
        "seasons": seasons,
        "all_seasons": all_seasons,
        "half_life": float(half_life),
        "min_sample": MIN_SAMPLE,
        "plays": int(len(el)),
        "teams": sorted(ex["team"].unique().tolist()),
        "team_exact": _pack(ex, by_team=True),
        "team_pooled": _pack(po, by_team=True),
        "team_distance": _pack(dd, by_team=True),
        "team_down": _pack(dn, by_team=True),
        "league_exact": _pack(lg, by_team=False),
    }


def query(tables: Dict[str, Any], team: Optional[str], down: Any, distance: Any,
          yards_to_goal: Any) -> Dict[str, Any]:
    """Walk the ladder until a rung has `sample_size >= 30`. Returns a TendencyBlock.

    A team with no plays in a bucket, or a team not in the tables at all, falls
    through rather than dividing by zero. Rung 5 is league-wide by construction
    and reports `team: None`, so nothing downstream can attribute it to anybody.
    """
    key = buckets.bucket(down, distance, yards_to_goal)
    league_stats = tables["league_exact"].get(key)
    league_pass_rate = league_stats["pass_rate"] if league_stats else None
    floor = tables.get("min_sample", MIN_SAMPLE)

    ladder: List[Tuple[int, Optional[Dict[str, Any]], str]] = [
        (1, _get(tables["team_exact"], team, key), key),
        (2, _get(tables["team_pooled"], team, key), buckets.pooled_key(down, distance, yards_to_goal)),
        (3, _get(tables["team_distance"], team, buckets.distance_key(down, distance)),
            buckets.distance_key(down, distance)),
        (4, _get(tables["team_down"], team, buckets.down_key(down)), buckets.down_key(down)),
    ]
    for rung, stats, matched in ladder:
        if stats is not None and stats["sample_size"] >= floor:
            return _block(key, team, rung, matched, stats, league_pass_rate)
    return _block(key, None, 5, key, league_stats or _empty(), league_pass_rate)


def _block(key: str, team: Optional[str], rung: int, matched: str,
           stats: Dict[str, Any], league_pass_rate: Optional[float]) -> Dict[str, Any]:
    return {
        "bucket": key,
        "team": team,
        "rung": rung,
        "confidence": RUNG_CONFIDENCE[rung],
        "sample_size": stats["sample_size"],
        "pass_rate": stats["pass_rate"],
        "league_pass_rate": league_pass_rate,
        "success_rate": stats["success_rate"],
        "explosive_rate": stats["explosive_rate"],
        "matched_key": matched,
    }


def _get(table: Dict[str, Dict[str, Any]], team: Optional[str], key: str) -> Optional[Dict[str, Any]]:
    if team is None:
        return None
    return table.get(team, {}).get(key)


def _empty() -> Dict[str, Any]:
    return {"sample_size": 0, "pass_rate": None, "success_rate": None, "explosive_rate": None}


def _exact_key(frame: pd.DataFrame) -> pd.Series:
    return "d" + frame["down"].astype(str) + "_" + frame["band"] + "_" + frame["zone"]


def _rate(numerator: float, weight: float) -> Optional[float]:
    return round(float(numerator) / float(weight), 4) if weight > 0 else None


def _pack(frame: pd.DataFrame, by_team: bool) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for row in frame.itertuples(index=False):
        stats = {"sample_size": int(row.n),
                 "pass_rate": _rate(row.w_pass, row.w_n),
                 "success_rate": _rate(row.w_success, row.w_n),
                 "explosive_rate": _rate(row.w_explosive, row.w_n)}
        if by_team:
            out.setdefault(row.team, {})[row.key] = stats
        else:
            out[row.key] = stats
    return out


# --------------------------------------------------------------------------- #

_SITUATIONS = [
    ("3rd and 6, midfield", 3, 6, 45),
    ("3rd and 11, own territory", 3, 11, 72),
    ("1st and 10, own territory", 1, 10, 75),
    ("2nd and 2, red zone", 2, 2, 8),
    ("1st and goal from the 4", 1, 4, 4),
    ("4th and 1, opponent 35", 4, 1, 35),
    ("2nd and 9, backed up", 2, 9, 92),
    ("3rd and 1, opponent 22", 3, 1, 22),
]


def _show(tables: Dict[str, Any], team: str, label: str, down: int, distance: int, ytg: int) -> None:
    block = query(tables, team, down, distance, ytg)
    print("  {:<28} {}".format(label, block))


def _report(path: Path, seasons: Optional[List[int]], teams: List[str]) -> None:
    import schema
    df = schema.read_plays(path)
    tables = build(df, seasons=seasons)
    league = tables["league"]
    print("=" * 100)
    print("{}  file={}  rows={}  eligible={}  teams={}".format(
        league.upper(), path.name, len(df), tables["plays"], len(tables["teams"])))
    print("  seasons weighted {} (half-life {}), rung 4 pools {}".format(
        tables["seasons"], tables["half_life"], tables["all_seasons"]))
    covered = sum(1 for k in buckets.BUCKET_KEYS
                  if tables["league_exact"].get(k, {}).get("sample_size", 0) >= MIN_SAMPLE)
    thin = [(k, tables["league_exact"].get(k, {}).get("sample_size", 0)) for k in buckets.BUCKET_KEYS
            if tables["league_exact"].get(k, {}).get("sample_size", 0) < MIN_SAMPLE]
    print("  league_exact buckets at or above {}: {}/{}   thin: {}".format(
        MIN_SAMPLE, covered, len(buckets.BUCKET_KEYS), thin))
    for team in teams:
        print("-" * 100)
        print("{} / {}".format(league, team))
        for label, d, dist, ytg in _SITUATIONS:
            _show(tables, team, label, d, dist, ytg)
    print("-" * 100)
    print("{} / unknown team (must land on rung 5 with team None)".format(league))
    _show(tables, "Not A Real Team", "name not in tables", 3, 6, 45)
    _show(tables, None, "team is None", 3, 6, 45)
    _checks(df, tables, teams[0])


def _checks(df: pd.DataFrame, tables: Dict[str, Any], team: str) -> None:
    """Traps the ladder has to survive, each answered with a printed measurement."""
    league, seasons = tables["league"], tables["seasons"]
    print("-" * 100)
    print("CHECKS / {}".format(league))

    # 1. A bucket with zero plays anywhere must return, not divide by zero.
    empty = [k for k in buckets.BUCKET_KEYS
             if tables["league_exact"].get(k, {}).get("sample_size", 0) == 0]
    print("  league buckets with zero plays: {} {}".format(len(empty), empty))
    for key in empty[:1]:
        d, band, zone = key.split("_", 2)
        blk = query(tables, team, int(d[1:]), {"short": 2, "medium": 6, "long": 10}[band],
                    {"own_deep": 90, "own": 70, "mid": 50, "opp": 30, "red": 10}[zone])
        print("  zero-play bucket {} -> {}".format(key, blk))

    # 2. Rung 5 can never carry team attribution.
    # 3. Every rung-1-to-4 block must clear the sample floor.
    attributed = below = 0
    rungs: Dict[int, int] = {}
    counts = (eligible(df)
              .assign(key=lambda f: buckets.bucket_series(f["down"], f["distance"], f["yards_to_goal"]))
              .groupby(["offense", "key"]).size())
    for (tm, key), n in counts.items():
        d, band, zone = key.split("_", 2)
        blk = query(tables, tm, int(d[1:]), {"short": 2, "medium": 6, "long": 10}[band],
                    {"own_deep": 90, "own": 70, "mid": 50, "opp": 30, "red": 10}[zone])
        rungs[blk["rung"]] = rungs.get(blk["rung"], 0) + int(n)
        attributed += int(blk["rung"] == 5 and blk["team"] is not None)
        below += int(blk["rung"] < 5 and blk["sample_size"] < MIN_SAMPLE)
    print("  rung-5 blocks carrying a team name: {} (must be 0)".format(attributed))
    print("  rungs 1-4 returned below the sample floor: {} (must be 0)".format(below))
    total = sum(rungs.values())
    print("  rung distribution weighted by real snaps ({} plays): {}".format(
        total, {r: "{} ({:.1%})".format(n, n / total) for r, n in sorted(rungs.items())}))

    # 4. Widening must be monotone: each team rung sees at least as many plays as the one above.
    breaks = 0
    for tm in tables["teams"]:
        for key in buckets.BUCKET_KEYS:
            d, band, zone = key.split("_", 2)
            sizes = [tables["team_exact"].get(tm, {}).get(key, {}).get("sample_size", 0),
                     tables["team_pooled"].get(tm, {}).get(key, {}).get("sample_size", 0),
                     tables["team_distance"].get(tm, {}).get("{}_{}".format(d, band), {}).get("sample_size", 0),
                     tables["team_down"].get(tm, {}).get(d, {}).get("sample_size", 0)]
            if any(sizes[i] > sizes[i + 1] for i in range(3)):
                breaks += 1
    print("  team x bucket ladders where widening shrank the sample: {} (must be 0)".format(breaks))

    # 5. Recompute one cell straight from the parquet, no shared code.
    key = "d3_medium_mid"
    el = eligible(df)
    cell = el[(el["offense"] == team) & (el["down"] == 3) & (el["distance"].between(4, 7))
              & (el["yards_to_goal"].between(40, 59))]
    ref = max(seasons)
    w = (0.5 ** ((ref - pd.to_numeric(cell["season"])) / tables["half_life"]))
    yards = pd.to_numeric(cell["yards_gained"], errors="coerce")
    expl = ((cell["is_pass"].astype(bool) & (yards >= EXPLOSIVE_PASS_YARDS))
            | (cell["is_rush"].astype(bool) & (yards >= EXPLOSIVE_RUSH_YARDS)))
    hand = {"sample_size": int(len(cell)),
            "pass_rate": round(float((cell["is_pass"].astype(bool) * w).sum() / w.sum()), 4),
            "success_rate": round(float((cell["success"].astype(bool) * w).sum() / w.sum()), 4),
            "explosive_rate": round(float((expl * w).sum() / w.sum()), 4)}
    got = tables["team_exact"][team][key]
    print("  hand-recompute {} {} -> {}".format(team, key, hand))
    print("  table says                      -> {}".format(got))
    print("  match: {}".format(hand == got))

    # 6. Weighted sample_size would have been a different, larger number.
    print("  raw n {} vs weighted-sum n {:.2f} (contract wants the raw one)".format(
        hand["sample_size"], float(w.sum())))


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    for name, seasons, teams in (
        ("plays_cfb.parquet", [2023, 2024, 2025], ["Alabama", "Air Force", "Ohio State"]),
        ("plays_nfl.parquet", None, ["KC", "BAL", "PHI"]),
    ):
        path = root / "data" / name
        if path.exists():
            _report(path, seasons, teams)
        else:
            print("skip {}, not on disk".format(path))

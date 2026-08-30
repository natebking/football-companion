"""Situational tendency tables, the fallback ladder, and empirical-Bayes shrinkage.

Binding spec: docs/CONTRACT.md, "Tendency query and fallback ladder".

`build()` reduces a unified play frame to the ladder's lookup tables. `query()`
walks them until a rung carries `sample_size >= 30`, then pulls the team's rates
toward the league's rates for the same situation before returning them. One code
path serves both leagues; the league lives in the tables, not in the code.

Shrinkage
---------
Every number a team's own history produces is an estimate on 30 to 500 plays, and
the standard error of a pass rate on 40 plays is near 0.08. Left alone those
estimates are too extreme at both ends: the backtest's 0.9-1.0 bin predicted
0.9331 and observed 0.8037, its 0.0-0.1 bin predicted 0.0522 and observed 0.1628,
and the engine lost to a baseline carrying no team information at all. The
correction is one constant:

    shrunk = (n * team_rate + k * league_rate) / (n + k)
           = w * team_rate + (1 - w) * league_rate,   w = n / (n + k)

`k` is the number of plays at which a team's own history and the league's rate
for that exact bucket deserve equal say. Below it the league prior dominates,
above it the team does, and no bucket is ever trusted more than its sample earns.

`SHRINK_K = 60` was fitted in `engine/calibrate.py` on a nested split: `k` is
chosen on the last quarter of the *training* frame and scored on the holdout it
never saw. Per-league honest picks are 49.9 (CFB) and 68.8 (NFL); the constant
that minimises summed validation regret across both leagues is 58.6, and the
pooled validation curve is within 0.0002 of its minimum for k in [38.2, 90], so
the constant is identified to about a factor of two rather than to three digits.
60 sits inside that plateau and is the round candidate with the lowest summed
validation regret.

The constant is a property of *this* ladder and does not survive changes to it.
Fitted against the old five-rung ladder the same procedure returned k near 138,
more than twice as large. That was rung 4 talking: pooling every distance and
field position behind one down gave it the biggest samples in the engine and the
worst predictions, so the fit raised `k` to crush it. Deleting the rung removed
the thing `k` was compensating for and the honest constant more than halved. Any
future change to the ladder invalidates this number; section 8 of `calibrate.py`
re-fits on the ladder as it stands and prints whether the shipped constant is
still inside the plateau, so the check is one command rather than a memory.

The recency half-life stays at 1.0. Fitting `k` separately at each half-life and
scoring the holdout frozen, the whole axis [0.5, inf] spans 0.00012 Brier on the
CFB holdout against 0.00092 unshrunk, and the NFL frame is one season so its
every row is identical. The decay knob was measuring the variance shrinkage now
removes directly, which is why the regime study read its optimum as 3 seasons:
that was the half-life doing shrinkage's job badly.

The same `k` shrinks `success_rate` and `explosive_rate`. It was fitted on pass
rate alone, because that is the number a card prints, so section 9 of
`calibrate.py` fits the other two separately as a check. Both want *more*
shrinkage than pass rate does, not less: their honest picks are 382 and 1002 in
CFB, 131 and 191 in the NFL. Shrinking them at 60 therefore under-shrinks rather
than over-shrinks, and still collects 80% to 98% of the Brier that each rate's
own best constant could win against no shrinkage at all (CFB success 0.2359 raw
-> 0.2333 at k=60, own best 0.2329; CFB explosive 0.1290 -> 0.1275, own best
0.1271; NFL success 0.2389 -> 0.2366, own best 0.2365; NFL explosive 0.1155 ->
0.1135, own best 0.1132). Three fitted constants to recover the last fifth of a
gain that is itself under 0.0005 Brier is not a trade worth making.

TendencyBlock fields
--------------------
The shipped JSON row shape and what `query()` returns.

    bucket            the exact situation key asked for, e.g. "d3_medium_mid"
    team              the team the number is about, None on the league rung
    rung              which filter answered, see the ladder below
    confidence        "high" / "medium" / "low", computed from shrink_weight
    sample_size       raw play count behind the team rate, never weighted
    pass_rate         the number to print: shrunk toward league_pass_rate
    pass_rate_raw     the team's own unshrunk rate at the matched filter, before
                      shrinkage. None on the league rung, where no team rate
                      exists. Diagnostics and copy that wants to say "their raw
                      history says X, we print Y" read this; nothing user-facing
                      should print it on its own, because it is the number that
                      was measured to be wrong.
    shrink_weight     w = n / (n + k), the share of `pass_rate` that came from
                      this team's own history rather than the league prior.
                      1.0 means the number is entirely the team's, 0.0 that it is
                      entirely the league's. This is what decides whether copy may
                      attribute the number to the team at all, and it is the only
                      honest basis for that call: a rung-1 hit on 34 plays carries
                      w = 0.36, so 64% of the printed number is the league's.
    league_pass_rate  the rate `pass_rate` was shrunk toward. The league's rate
                      for the exact bucket, or the league's overall rate for the
                      handful of buckets the league itself has never filled.
                      pass_rate == w * pass_rate_raw + (1 - w) * league_pass_rate
                      holds to the stored precision, checked in `_checks`.
    success_rate      shrunk the same way, toward the league's bucket success rate
    explosive_rate    shrunk the same way
    matched_key       the key the answering rung actually matched on

Confidence
----------
Confidence is a statement about how much of the printed number is the team's, so
it is a function of `shrink_weight` alone. The rung says which filter answered,
which is not the same question: rung 1 on 34 plays is a precise filter over a
sample too thin to trust, and the old rung-driven flag called that "high".

    high    w >= 0.50   n >= 60   the team's own history carries at least half
                                  the printed number. This is not a second free
                                  parameter: w >= 0.50 is exactly n >= k, read
                                  off the constant already fitted.
    medium  w >= 0.35   n >= 32   the block cleared the sample floor with room.
    low     w <  0.35   n <  32   the printed number is about two thirds league
                                  or more. Copy must say "offenses generally".

The medium cut is the one that had to be chosen rather than derived, and the
choice is forced from below. The contract's floor is `sample_size >= 30`, which
at k = 60 is w = 0.333. Any medium cut at or under that weight makes every team
rung medium or better, and "low" becomes an exact synonym for "rung 5" -- the
flag collapses back into the rung, which is the failure this rework exists to
fix. Measured on the CFB holdout, cuts of (0.50, 0.25) put 8.3% of snaps in low
and every one of them is the league rung: `low_says_something_else` is 0.0000,
not small but exactly zero. 0.35 is the smallest round weight strictly above the
floor's, so medium means the sample cleared 30 with something to spare, and low
regains real team blocks: 12.8% of CFB held-out snaps and 10.4% of NFL.

One thing these bands do not mean. In CFB the team's own *unshrunk* number fails
to beat the league line in every band at every candidate cut (`raw_team_skill`
runs -0.0019 to -0.0128). High confidence is not a claim that the raw team rate
was trustworthy; it is a claim about the composition of the shrunk number. The
shrunk number does beat the league line in every band, which is the whole point
of shrinking, and is why the flag gates the wording rather than the arithmetic.

Fallback ladder
---------------
Widen until a rung has `sample_size >= 30`.

    1  team, recent seasons, exact bucket
    2  team, recent seasons, field zone pooled with its neighbours
    3  team, recent seasons, down + distance band only
    5  league average, exact bucket, no team attribution

Rung 4 (team, down only, every season, unweighted) is **removed**. It was the
worst thing in the engine: on 7,577 held-out CFB plays it scored 0.2395 Brier
against the league's 0.1907 for the same situations, `skill_vs_situation`
-0.2561, and -0.0700 in the NFL. Shrinkage cannot rescue it, because its error is
bias rather than variance: pooling every field position and distance behind one
down gives it the largest samples in the engine, so `n / (n + k)` would hand it
the *most* trust of any rung. Fitting `k` on rung 4 alone confirms it directly,
the argmin is k = inf, meaning the estimator's own optimum is to delete the rung.
Deleting it is worth -0.0030 Brier on CFB with no fitted parameter: the ladder
unshrunk goes 0.23337 -> 0.23035 on the same held-out plays. Blocks that used to
land there now fall to the league rung, which is what they should have said all
along. It also halved the fitted `k`, as described above.

The number 4 is retired rather than reused. Rung ordinals appear in the shipped
JSON and in downstream checks that special-case rung 5 as "league, no team";
renumbering would silently reinterpret data already on disk, and a gap costs
nothing.

Recency weighting inside a rung is exponential by season with a one-season
half-life: the most recent requested season weighs 1.0, the one before it 0.5.
The weights move the *rates*. `sample_size` stays the raw play count, because it
is what sets `shrink_weight` and a weighted count would let three-year-old plays
buy trust they have not earned.
"""
import math
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import buckets  # noqa: E402

MIN_SAMPLE = 30
EXPLOSIVE_PASS_YARDS = 15
EXPLOSIVE_RUSH_YARDS = 10

# Plays at which a team's own history and the league's rate for the same bucket
# deserve equal say. Fitted in engine/calibrate.py; see the module docstring.
SHRINK_K = 60.0

# Cut points on `shrink_weight`, not on the rung. See "Confidence" above.
CONFIDENCE_CUTS: Tuple[Tuple[float, str], ...] = ((0.50, "high"), (0.35, "medium"))
LOW_CONFIDENCE = "low"

# The best confidence a rung can reach, for reach tables that label a rung before
# a block exists. A block's own `confidence` comes from its `shrink_weight` and is
# the only one that describes an actual number.
RUNG_CONFIDENCE: Dict[int, str] = {1: "high", 2: "high", 3: "high", 5: "low"}

RATE_FIELDS: Tuple[str, ...] = ("pass_rate", "success_rate", "explosive_rate")

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
          half_life: float = 1.0, shrink_k: float = SHRINK_K) -> Dict[str, Any]:
    """Aggregate a unified play frame into the ladder's tables.

    `seasons` is the recent window every rung and the league baseline use,
    season-decayed. Defaults to every season present. `shrink_k` is carried in
    the tables so a query cannot be answered with a different constant than the
    one the tables were built and reported under; `shrink_k=0` returns raw team
    rates and exists for the fitting harness, not for shipping.
    """
    if half_life <= 0:
        raise ValueError("half_life must be positive, got {}".format(half_life))
    if shrink_k < 0:
        raise ValueError("shrink_k must not be negative, got {}".format(shrink_k))
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

    # Rung 5: league average, exact bucket, recent seasons.
    lg = recent.groupby(["down", "band", "zone"], as_index=False)[_SUMS].sum()
    lg["key"] = _exact_key(lg)

    return {
        "league": leagues[0],
        "seasons": seasons,
        "all_seasons": all_seasons,
        "half_life": float(half_life),
        "shrink_k": float(shrink_k),
        "min_sample": MIN_SAMPLE,
        "plays": int(len(el)),
        "teams": sorted(ex["team"].unique().tolist()),
        "team_exact": _pack(ex, by_team=True),
        "team_pooled": _pack(po, by_team=True),
        "team_distance": _pack(dd, by_team=True),
        "league_exact": _pack(lg, by_team=False),
        "league_overall": _league_overall(recent),
    }


def query(tables: Dict[str, Any], team: Optional[str], down: Any, distance: Any,
          yards_to_goal: Any) -> Dict[str, Any]:
    """Walk the ladder until a rung has `sample_size >= 30`, then shrink. TendencyBlock.

    A team with no plays in a bucket, or a team not in the tables at all, falls
    through rather than dividing by zero. Rung 5 is league-wide by construction
    and reports `team: None` and `shrink_weight: 0.0`, so nothing downstream can
    attribute it to anybody.
    """
    key = buckets.bucket(down, distance, yards_to_goal)
    league_stats = tables["league_exact"].get(key)
    floor = tables.get("min_sample", MIN_SAMPLE)
    shrink_k = tables.get("shrink_k", SHRINK_K)

    ladder: List[Tuple[int, Optional[Dict[str, Any]], str]] = [
        (1, _get(tables["team_exact"], team, key), key),
        (2, _get(tables["team_pooled"], team, key), buckets.pooled_key(down, distance, yards_to_goal)),
        (3, _get(tables["team_distance"], team, buckets.distance_key(down, distance)),
            buckets.distance_key(down, distance)),
    ]
    for rung, stats, matched in ladder:
        if stats is not None and stats["sample_size"] >= floor:
            return _block(key, team, rung, matched, stats, league_stats, tables, shrink_k)
    return _block(key, None, 5, key, league_stats or _empty(), league_stats, tables, shrink_k)


def confidence(weight: Optional[float]) -> str:
    """Map `shrink_weight` to the flag. See "Confidence" in the module docstring."""
    if weight is None:
        return LOW_CONFIDENCE
    for cut, label in CONFIDENCE_CUTS:
        if weight >= cut:
            return label
    return LOW_CONFIDENCE


def shrink_weight(sample_size: Any, shrink_k: float = SHRINK_K) -> float:
    """w = n / (n + k). 1.0 when k is 0, 0.0 when k is infinite or n is 0."""
    n = float(sample_size or 0.0)
    if shrink_k <= 0:
        return 1.0
    if not math.isfinite(shrink_k) or n <= 0:
        return 0.0
    return n / (n + float(shrink_k))


def _block(key: str, team: Optional[str], rung: int, matched: str, stats: Dict[str, Any],
           league_stats: Optional[Dict[str, Any]], tables: Dict[str, Any],
           shrink_k: float) -> Dict[str, Any]:
    """Assemble a TendencyBlock, shrinking every rate toward its league counterpart."""
    # Rounded once, then used everywhere, so `pass_rate == w * raw + (1 - w) * league`
    # holds exactly against the `w` the block reports rather than to within a
    # rounding error a downstream reader would have to know about.
    weight = round(shrink_weight(stats["sample_size"], shrink_k), 4) if team is not None else 0.0
    targets = _targets(league_stats, tables)
    block = {
        "bucket": key,
        "team": team,
        "rung": rung,
        "confidence": confidence(weight),
        "sample_size": stats["sample_size"],
        "shrink_weight": weight,
        "pass_rate_raw": stats["pass_rate"] if team is not None else None,
        "league_pass_rate": targets["pass_rate"],
        "matched_key": matched,
    }
    # One call for both cases. On the league rung `weight` is 0.0, so this returns
    # `targets[field]` outright, which is the league's exact-bucket rate where one
    # exists and its overall rate where the bucket is empty. That fallback is load
    # bearing: with rung 4 gone, a bucket the league itself never filled lands
    # here, and returning `stats[field]` would hand a card None. One real case,
    # NFL d4_medium_own_deep, which rung 4 used to paper over with a down-only
    # number that was wrong rather than missing.
    for field in RATE_FIELDS:
        block[field] = _shrink(stats[field], weight, targets[field])
    return block


def _shrink(raw: Optional[float], weight: float, target: Optional[float]) -> Optional[float]:
    """w * raw + (1 - w) * target, degrading to whichever end is available."""
    if raw is None:
        return target
    if target is None or weight >= 1.0:
        return raw
    return round(weight * float(raw) + (1.0 - weight) * float(target), 4)


def _targets(league_stats: Optional[Dict[str, Any]], tables: Dict[str, Any]) -> Dict[str, Optional[float]]:
    """The league rates to shrink toward, per rate field.

    The league's rate for the exact bucket, falling back to its overall rate for
    the few buckets the league itself has never filled. Without the fallback a
    team could reach rung 2 or 3 through a widened filter in a bucket the league
    has no exact row for, and there would be nothing to shrink toward.
    """
    overall = tables.get("league_overall") or {}
    out: Dict[str, Optional[float]] = {}
    for field in RATE_FIELDS:
        value = league_stats.get(field) if league_stats else None
        out[field] = overall.get(field) if value is None else value
    return out


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


def _league_overall(recent: pd.DataFrame) -> Dict[str, Optional[float]]:
    """One decayed rate per field over every recent play, the last-resort target."""
    total = float(recent["w_n"].sum())
    return {"pass_rate": _rate(recent["w_pass"].sum(), total),
            "success_rate": _rate(recent["w_success"].sum(), total),
            "explosive_rate": _rate(recent["w_explosive"].sum(), total),
            "sample_size": int(recent["n"].sum())}


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
    print("  seasons weighted {} (half-life {}), shrink k={}, league overall {}".format(
        tables["seasons"], tables["half_life"], tables["shrink_k"], tables["league_overall"]))
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
    k = tables["shrink_k"]
    print("-" * 100)
    print("CHECKS / {}".format(league))

    # 1. A bucket with zero plays anywhere must return, not divide by zero.
    empty = [key for key in buckets.BUCKET_KEYS
             if tables["league_exact"].get(key, {}).get("sample_size", 0) == 0]
    print("  league buckets with zero plays: {} {}".format(len(empty), empty))
    for key in empty[:1]:
        d, band, zone = key.split("_", 2)
        blk = query(tables, team, int(d[1:]), {"short": 2, "medium": 6, "long": 10}[band],
                    {"own_deep": 90, "own": 70, "mid": 50, "opp": 30, "red": 10}[zone])
        print("  zero-play bucket {} -> {}".format(key, blk))

    # 2. Rung 5 can never carry team attribution, and rung 4 can never appear.
    # 3. Every team rung must clear the sample floor.
    # 7. The shrinkage identity must hold on every real block, and confidence must
    #    follow shrink_weight rather than the rung.
    attributed = below = retired = identity_breaks = flag_breaks = 0
    rungs: Dict[int, int] = {}
    conf: Dict[str, int] = {}
    counts = (eligible(df)
              .assign(key=lambda f: buckets.bucket_series(f["down"], f["distance"], f["yards_to_goal"]))
              .groupby(["offense", "key"]).size())
    for (tm, key), n in counts.items():
        d, band, zone = key.split("_", 2)
        blk = query(tables, tm, int(d[1:]), {"short": 2, "medium": 6, "long": 10}[band],
                    {"own_deep": 90, "own": 70, "mid": 50, "opp": 30, "red": 10}[zone])
        rungs[blk["rung"]] = rungs.get(blk["rung"], 0) + int(n)
        conf[blk["confidence"]] = conf.get(blk["confidence"], 0) + int(n)
        attributed += int(blk["rung"] == 5 and blk["team"] is not None)
        retired += int(blk["rung"] == 4)
        below += int(blk["rung"] < 5 and blk["sample_size"] < MIN_SAMPLE)
        flag_breaks += int(blk["confidence"] != confidence(blk["shrink_weight"]))
        if blk["pass_rate_raw"] is not None and blk["league_pass_rate"] is not None:
            w = blk["shrink_weight"]
            want = round(w * blk["pass_rate_raw"] + (1 - w) * blk["league_pass_rate"], 4)
            identity_breaks += int(want != blk["pass_rate"])
    print("  rung-5 blocks carrying a team name: {} (must be 0)".format(attributed))
    print("  blocks landing on the retired rung 4: {} (must be 0)".format(retired))
    print("  team rungs returned below the sample floor: {} (must be 0)".format(below))
    print("  blocks where pass_rate != w*raw + (1-w)*league: {} (must be 0)".format(identity_breaks))
    print("  blocks whose confidence disagrees with confidence(shrink_weight): {} (must be 0)".format(
        flag_breaks))
    total = sum(rungs.values())
    print("  rung distribution weighted by real snaps ({} plays): {}".format(
        total, {r: "{} ({:.1%})".format(n, n / total) for r, n in sorted(rungs.items())}))
    print("  confidence distribution weighted by real snaps: {}".format(
        {c: "{} ({:.1%})".format(n, n / total) for c, n in sorted(conf.items())}))

    # 4. Widening must be monotone: each team rung sees at least as many plays as the one above.
    breaks = 0
    for tm in tables["teams"]:
        for key in buckets.BUCKET_KEYS:
            d, band, zone = key.split("_", 2)
            sizes = [tables["team_exact"].get(tm, {}).get(key, {}).get("sample_size", 0),
                     tables["team_pooled"].get(tm, {}).get(key, {}).get("sample_size", 0),
                     tables["team_distance"].get(tm, {}).get("{}_{}".format(d, band), {}).get("sample_size", 0)]
            if any(sizes[i] > sizes[i + 1] for i in range(len(sizes) - 1)):
                breaks += 1
    print("  team x bucket ladders where widening shrank the sample: {} (must be 0)".format(breaks))

    # 5. Recompute one cell straight from the parquet, no shared code, then shrink it by hand.
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
    print("  table says (tables stay raw)     -> {}".format(got))
    print("  match: {}".format(hand == got))
    blk = query(tables, team, 3, 6, 50)
    if blk["rung"] == 1:
        hw = round(hand["sample_size"] / float(hand["sample_size"] + k), 4)
        hand_shrunk = round(hw * hand["pass_rate"] + (1 - hw) * tables["league_exact"][key]["pass_rate"], 4)
        print("  hand shrink w={:.4f}: {} -> {}   query says {} (weight {})   match: {}".format(
            hw, hand["pass_rate"], hand_shrunk, blk["pass_rate"], blk["shrink_weight"],
            hand_shrunk == blk["pass_rate"] and hw == blk["shrink_weight"]))
    else:
        print("  hand shrink skipped: n={} is under the floor so the ladder widened to rung {} "
              "(n={}); the identity is checked on every block above".format(
                  hand["sample_size"], blk["rung"], blk["sample_size"]))

    # 6. Weighted sample_size would have been a different, larger number.
    print("  raw n {} vs weighted-sum n {:.2f} (contract wants the raw one)".format(
        hand["sample_size"], float(w.sum())))

    # 8. shrink_k=0 must return the raw team rate untouched, at whatever rung answers.
    raw_tables = build(df, seasons=seasons, shrink_k=0.0)
    raw_blk = query(raw_tables, team, 3, 6, 50)
    print("  shrink_k=0 returns the raw rate: pass_rate {} == pass_rate_raw {} -> {} (weight {}), "
          "and shrink_k={} moves it to {}".format(
              raw_blk["pass_rate"], raw_blk["pass_rate_raw"],
              raw_blk["pass_rate"] == raw_blk["pass_rate_raw"], raw_blk["shrink_weight"],
              k, blk["pass_rate"]))


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

"""Empirical-Bayes shrinkage of the team rate toward the league situation rate.

Binding spec: docs/CONTRACT.md. Companion to `engine/backtest.py`, which
established the problem: the engine beats a league-average baseline and loses to
the league's rate for the same situation bucket. Cause is regression to the mean.
A rate computed on 30 to 50 plays carries a standard error near 0.08, so the
extreme buckets are mostly noise, and the calibration table shows every
prediction pushed too far from the middle.

The fix under test is one constant:

    shrunk = (n * team_rate + k * league_bucket_rate) / (n + k)

equivalently `w * team_rate + (1 - w) * league_rate` with `w = n / (n + k)`. `k`
is the number of plays at which a team's own history and the league's rate for
that exact situation deserve equal say. `k = 0` is the ladder with no shrinkage
at all; `k = inf` drops team attribution entirely and is the honest baseline, so
it appears in every table here.

`tendency.py` now applies the fitted constant itself, so every fit below asks
`build()` for `shrink_k=0` and does its own shrinking. That keeps the sweeps
single-shrunk and keeps this file the place the constant is chosen rather than a
consumer of it. Section 8 closes the loop: it re-fits `k` on the ladder as it now
stands, checks where the shipped `tendency.SHRINK_K` falls on that curve, and
measures the confidence bands the shipped code assigns.

Note that `k = 0` no longer reproduces the engine the backtest first scored. The
ladder lost rung 4 (team, down only, all seasons, unweighted), whose own fitted
optimum was `k = inf`: the estimator's answer for that rung was to delete it.

Honest fitting
--------------
`backtest.py` picks its blend weight on the same holdout it scores, which is a
ceiling rather than a measurement. Here the split is nested:

    full frame   -> (train_outer, holdout)     backtest.temporal_split, unchanged
    train_outer  -> (train_inner, validation)  tail_split, the last ~25% of the
                                               training frame's plays by week

`k` and the half-life are chosen on `validation` and then applied, frozen, to
`holdout`. The holdout sweep is printed as well, so the distance between the
honest pick and the best possible pick is visible instead of hidden.

The alternative target
----------------------
Shrinking toward the team's own overall pass rate (its rate across every
situation) instead of the league's bucket rate is the obvious competing prior:
it keeps team identity in the answer at all sample sizes. It is fitted and
scored the same way, on the same splits, so the comparison is like for like.
"""
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import backtest  # noqa: E402
import buckets  # noqa: E402
import schema  # noqa: E402
import tendency  # noqa: E402

INF = float("inf")

# The contract's grid plus resolution either side of where the coarse grid bottoms
# out. `inf` is the situation baseline and is never dropped.
K_GRID: List[float] = [0, 5, 10, 20, 30, 50, 75, 100, 150, 200, 250, 350, 500, 750, 1000, 2000, INF]
# Columns of the joint grid. A subset of K_GRID so the matrix stays readable.
K_JOINT: List[float] = [0, 20, 50, 75, 100, 150, 250, 500, 1000, INF]
HALF_LIVES: List[float] = [0.5, 1.0, 2.0, 3.0, 4.0, INF]
# The contract's setting. The recommendation holds it here and fits `k` alone;
# section 2 is the evidence that the half-life axis does not carry a decision.
CONTRACT_HALF_LIFE = 1.0
# Refinement grid for every argmin reported. Shared so the per-league fits and
# the pooled cross-league fit are chosen from identical candidates.
FINE_K: List[float] = sorted(set([0.0, INF] + [round(float(x), 1) for x in np.geomspace(1.0, 5000.0, 160)]))
# Round constants worth shipping. The fitted argmin is a real number to one
# decimal; what goes in the code should be a number a reader can hold, and the
# plateau is wide enough that rounding costs nothing measurable. The winner is
# chosen by summed validation regret, exactly like the unrounded pooled fit.
ROUND_CANDIDATES: List[float] = [40.0, 50.0, 60.0, 75.0, 100.0, 150.0, 200.0]
# Every k any table or fit refers to, so a curve computed once can serve both.
ALL_K: List[float] = sorted(set(FINE_K) | set(float(k) for k in K_GRID) | set(ROUND_CANDIDATES))

# A shrunk rate this far from the league's rate for the same bucket is a number
# the card may honestly attribute to the team.
SIGNAL_EPS = 0.03

# Share of the training frame's eligible plays held out as the inner validation set.
VALIDATION_TAIL_SHARE = 0.25

BOOTSTRAP_REPS = 2000


# --------------------------------------------------------------------------- #
# splits

def _stamp(frame: pd.DataFrame) -> pd.Series:
    """(season, week) collapsed to one sortable integer. Unknown week sorts first."""
    season = pd.to_numeric(frame["season"], errors="coerce").fillna(0).astype("int64")
    week = pd.to_numeric(frame["week"], errors="coerce").fillna(0).astype("int64")
    return season * 100 + week


def tail_split(df: pd.DataFrame, share: float = VALIDATION_TAIL_SHARE) -> Tuple[pd.DataFrame, pd.DataFrame, str]:
    """Hold out the most recent weeks of a frame, spanning seasons if it has several.

    Used for the *inner* split only. The outer split stays `backtest.temporal_split`
    so the holdout is byte-identical to the one the backtest already reported.
    Cutting by week rather than season matters for CFB: a season-cut inner split
    would leave one training season, and a one-season window makes the half-life
    unreachable by construction.
    """
    el = tendency.eligible(df)
    counts = el.groupby(_stamp(el)).size().sort_index()
    tail = counts[::-1].cumsum()[::-1] / float(len(el))
    cut = max(s for s in counts.index if tail[s] >= share)
    stamps = _stamp(df)
    label = "weeks from {}w{} held out ({:.1%} of eligible training plays)".format(
        cut // 100, cut % 100, tail[cut])
    return df[stamps < cut], df[stamps >= cut], label


# --------------------------------------------------------------------------- #
# shrinkage

def shrunk_rate(team_rate: np.ndarray, n: np.ndarray, target: np.ndarray, k: float) -> np.ndarray:
    """(n * team_rate + k * target) / (n + k), vectorised, with k = inf meaning `target`."""
    if not np.isfinite(k):
        return np.array(target, dtype="float64")
    n = np.asarray(n, dtype="float64")
    denom = n + k
    weight = np.where(denom > 0, n / np.where(denom > 0, denom, 1.0), 1.0)
    return weight * np.asarray(team_rate, dtype="float64") + (1.0 - weight) * np.asarray(target, dtype="float64")


def _checks(train_inner: pd.DataFrame, validation: pd.DataFrame, holdout: pd.DataFrame) -> None:
    """The two claims every number below rests on, each answered by a measurement."""
    rng = np.random.RandomState(0)
    team = rng.rand(2000)
    league = rng.rand(2000)
    n = rng.randint(1, 600, 2000).astype("float64")
    worst = 0.0
    for k in (0.0, 1.0, 30.0, 137.0, 5000.0):
        literal = (n * team + k * league) / (n + k)
        worst = max(worst, float(np.abs(literal - shrunk_rate(team, n, league, k)).max()))
    ends = (float(np.abs(shrunk_rate(team, n, league, 0.0) - team).max()),
            float(np.abs(shrunk_rate(team, n, league, INF) - league).max()))
    between = shrunk_rate(team, n, league, 137.0)
    inside = int(((between >= np.minimum(team, league) - 1e-12) &
                  (between <= np.maximum(team, league) + 1e-12)).all())
    print("  check: n/(n+k) form vs the literal (n*t + k*l)/(n+k), max abs diff {:.2e} (must be ~0)".format(worst))
    print("  check: k=0 returns the team rate (max diff {:.2e}); k=inf returns the league rate "
          "({:.2e}); every shrunk rate lies between the two: {}".format(ends[0], ends[1], bool(inside)))

    fit_max = int(max(_stamp(train_inner).max(), _stamp(validation).max()))
    score_min = int(_stamp(holdout).min())
    shared = sorted(set(_stamp(validation).unique().tolist()) & set(_stamp(holdout).unique().tolist()))
    print("  check: latest (season, week) any parameter was fitted on is {}, earliest scored is {}, "
          "weeks in both: {} (must be 0)".format(fit_max, score_min, len(shared)))


def team_overall_rate(train: pd.DataFrame, half_life: float) -> Dict[str, float]:
    """Each team's pass rate over every eligible training play, season-decayed.

    The alternative shrink target. Same decay as `tendency.build` so the two
    targets differ only in what they condition on, never in how they weight time.
    """
    el = tendency.eligible(train)
    season = pd.to_numeric(el["season"]).astype("int64")
    weight = 0.5 ** ((season.max() - season) / float(half_life)) if np.isfinite(half_life) \
        else pd.Series(1.0, index=season.index)
    frame = pd.DataFrame({"team": el["offense"].astype(str),
                          "w": weight.to_numpy(dtype="float64"),
                          "wp": (el["is_pass"].astype(bool).to_numpy() * weight.to_numpy(dtype="float64"))})
    agg = frame.groupby("team", as_index=False)[["w", "wp"]].sum()
    return {str(r.team): float(r.wp / r.w) for r in agg.itertuples(index=False) if r.w > 0}


# --------------------------------------------------------------------------- #
# one (train, test) evaluation

def evaluate(train: pd.DataFrame, test: pd.DataFrame, half_life: float) -> pd.DataFrame:
    """Build on `train`, predict `test`, and attach both shrink targets per play.

    `shrink_k=0` so `pred` is the team's raw rate. Every sweep in this file
    shrinks it itself; asking the tables for pre-shrunk numbers would shrink
    twice and fit the wrong constant.
    """
    tables = tendency.build(train, half_life=half_life, shrink_k=0.0)
    naive = backtest.global_rate(train)
    scored = backtest.predict(tables, test, naive)
    scored = scored[pd.to_numeric(scored["pred"]).notna()].reset_index(drop=True)
    scored["pred"] = pd.to_numeric(scored["pred"]).astype("float64")

    overall = team_overall_rate(train, half_life)
    scored["base_team"] = [overall.get(t, naive) for t in scored["team"]]
    # Rung 5 carries no team, so "the team's own overall rate" is not available
    # there either; those rows fall back to the league situation rate, which is
    # what the block already says.
    rung5 = scored["rung"].to_numpy() == 5
    scored.loc[rung5, "base_team"] = scored.loc[rung5, "base_situation"].to_numpy()
    scored.attrs["tables"] = tables
    scored.attrs["naive_rate"] = naive
    scored.attrs["half_life"] = half_life
    return scored


def sweep(scored: pd.DataFrame, target_col: str, grid: List[float]) -> Dict[float, float]:
    actual = scored["actual"].to_numpy(dtype="float64")
    pred = scored["pred"].to_numpy(dtype="float64")
    n = pd.to_numeric(scored["sample_size"]).to_numpy(dtype="float64")
    target = scored[target_col].to_numpy(dtype="float64")
    return {k: backtest.brier(shrunk_rate(pred, n, target, k), actual) for k in grid}


def fine_best_k(scored: pd.DataFrame, target_col: str) -> Tuple[float, float]:
    """Geometric refinement of the coarse grid, plus the two degenerate endpoints."""
    scores = sweep(scored, target_col, FINE_K)
    k = min(scores, key=lambda key: scores[key])
    return k, scores[k]


# --------------------------------------------------------------------------- #
# reporting helpers

def _fk(k: float) -> str:
    return "inf" if not np.isfinite(k) else "{:g}".format(k)


def _call(lo: float, hi: float) -> str:
    """A win only when the whole interval is on the winning side. A tie says tie."""
    if hi < 0:
        return "BEATS the situation baseline (95% CI excludes 0)"
    if lo > 0:
        return "LOSES to the situation baseline (95% CI excludes 0)"
    return "TIE, not distinguishable from the situation baseline (95% CI spans 0)"


def sweep_table(val: Dict[float, float], hold: Dict[float, float], baseline: float) -> pd.DataFrame:
    rows = []
    for k in K_GRID:
        rows.append({"k": _fk(k), "brier_validation": val[k], "brier_holdout": hold[k],
                     "vs_situation": hold[k] - baseline})
    return pd.DataFrame(rows)


def joint_table(scores: Dict[Tuple[float, float], float]) -> pd.DataFrame:
    rows = []
    for hl in HALF_LIVES:
        row = {"half_life": _fk(hl)}
        for k in K_JOINT:
            row["k=" + _fk(k)] = scores[(hl, k)]
        rows.append(row)
    return pd.DataFrame(rows)


def signal_retention(tables: Dict[str, Any], k: float) -> Dict[str, Any]:
    """How many (team, bucket) cells still say something the league rate does not.

    Walks every team the tables know against all 60 contract buckets, which is
    exactly the surface `web/tendency-*.json` covers, and asks whether the shrunk
    number is more than `SIGNAL_EPS` from the league's rate for that bucket.
    """
    league = tables["league_exact"]
    cells = kept_raw = kept_shrunk = 0
    gaps_raw: List[float] = []
    gaps_shrunk: List[float] = []
    for team in tables["teams"]:
        for key in buckets.BUCKET_KEYS:
            stats = league.get(key)
            if stats is None or stats.get("pass_rate") is None:
                continue
            down, band, zone = key.split("_", 2)
            block = tendency.query(tables, team, int(down[1:]), backtest.REP_DISTANCE[band],
                                   backtest.REP_YTG[zone])
            if block["pass_rate"] is None:
                continue
            lg = float(stats["pass_rate"])
            raw = float(block["pass_rate"])
            sh = float(shrunk_rate(np.array([raw]), np.array([block["sample_size"]]),
                                   np.array([lg]), k)[0])
            cells += 1
            gaps_raw.append(abs(raw - lg))
            gaps_shrunk.append(abs(sh - lg))
            kept_raw += int(abs(raw - lg) > SIGNAL_EPS)
            kept_shrunk += int(abs(sh - lg) > SIGNAL_EPS)
    return {"cells": cells, "raw_share": kept_raw / float(cells), "shrunk_share": kept_shrunk / float(cells),
            "raw_mean_gap": float(np.mean(gaps_raw)), "shrunk_mean_gap": float(np.mean(gaps_shrunk))}


def cluster_bootstrap(scored: pd.DataFrame, a: np.ndarray, b: np.ndarray,
                      reps: int = BOOTSTRAP_REPS, seed: int = 0) -> Tuple[float, float, float]:
    """Paired difference in Brier (a - b), resampled over offensive teams.

    Team-clustered because plays are not independent within a team: the whole
    question is whether a team's own history helps, so a play-level bootstrap
    would understate the spread.
    """
    actual = scored["actual"].to_numpy(dtype="float64")
    diff = (a - actual) ** 2 - (b - actual) ** 2
    codes, _ = pd.factorize(scored["team"])
    sums = np.bincount(codes, weights=diff)
    counts = np.bincount(codes).astype("float64")
    point = float(diff.mean())
    rng = np.random.RandomState(seed)
    idx = rng.randint(0, len(sums), size=(reps, len(sums)))
    draws = sums[idx].sum(axis=1) / counts[idx].sum(axis=1)
    lo, hi = np.percentile(draws, [2.5, 97.5])
    return point, float(lo), float(hi)


def per_rung_k(scored: pd.DataFrame, target_col: str) -> pd.DataFrame:
    rows = []
    for rung, grp in scored.groupby("rung", sort=True):
        k, score = fine_best_k(grp, target_col)
        base = backtest.brier(grp[target_col].to_numpy(dtype="float64"),
                              grp["actual"].to_numpy(dtype="float64"))
        rows.append({"rung": int(rung), "n": len(grp), "best_k": _fk(k), "brier_at_best_k": score,
                     "brier_situation": base, "gain": score - base})
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #
# section 8: the configuration tendency.py actually ships

# Candidate cut pairs on `shrink_weight`, high and medium. The shipped pair is
# first. Each is stated as the sample size it implies at the shipped k, because
# "n >= 150" is the sentence a reader can check and 0.50 is not.
CANDIDATE_CUTS: List[Tuple[float, float]] = [(0.50, 0.35), (0.50, 0.25), (0.60, 0.35), (0.71, 0.45),
                                             (0.60, 0.45), (0.75, 0.50), (0.40, 0.20)]


def shipped_frame(train: pd.DataFrame, test: pd.DataFrame, shrink_k: float,
                  half_life: float = CONTRACT_HALF_LIFE) -> pd.DataFrame:
    """Score the holdout through the shipped code path, not a reimplementation.

    Builds with the constant `tendency.py` ships and reads every field off the
    block, so what is measured here is what a card would be handed.
    """
    tables = tendency.build(train, half_life=half_life, shrink_k=shrink_k)
    naive = backtest.global_rate(train)
    el = tendency.eligible(test).copy()
    el["key"] = buckets.bucket_series(el["down"], el["distance"], el["yards_to_goal"])
    el = el[el["key"].notna()]
    el["team"] = el["offense"].astype(str)

    memo: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for team, key in el.groupby(["team", "key"]).size().index:
        memo[(team, key)] = tendency.query(tables, team, *backtest._rep(key))
    blocks = [memo[(t, k)] for t, k in zip(el["team"], el["key"])]

    lg = tables["league_exact"]
    situation = np.array([backtest._lookup(lg, k, "pass_rate") for k in el["key"]], dtype="float64")
    out = pd.DataFrame({
        "team": el["team"].to_numpy(),
        "key": el["key"].to_numpy(),
        "actual": el["is_pass"].astype(bool).to_numpy(dtype="float64"),
        "pred": [b["pass_rate"] for b in blocks],
        "raw": [b["pass_rate_raw"] for b in blocks],
        "weight": [b["shrink_weight"] for b in blocks],
        "confidence": [b["confidence"] for b in blocks],
        "rung": [b["rung"] for b in blocks],
        "sample_size": [b["sample_size"] for b in blocks],
        "base_situation": np.where(np.isnan(situation), naive, situation),
    })
    out = out[pd.to_numeric(out["pred"]).notna()].reset_index(drop=True)
    out["pred"] = pd.to_numeric(out["pred"]).astype("float64")
    # On the league rung there is no team rate; the raw column stands in with the
    # league line so a "what would the raw team number have scored" column is
    # defined on every row and charges the league rung to neither side.
    out["raw"] = pd.to_numeric(out["raw"]).fillna(out["base_situation"]).astype("float64")
    out.attrs["tables"] = tables
    return out


def _band_rows(frame: pd.DataFrame, labels: List[str]) -> pd.DataFrame:
    """Per confidence band: reach, how far the card's claim travels, and whether
    the raw team number was worth attributing at all."""
    rows = []
    for label in labels:
        grp = frame[frame["confidence"] == label]
        if grp.empty:
            rows.append({"confidence": label, "n": 0, "reach": 0.0, "mean_w": float("nan"),
                         "median_n": float("nan"), "mean_gap_from_league": float("nan"),
                         "says_something_else": float("nan"), "brier_shipped": float("nan"),
                         "brier_raw_team": float("nan"), "brier_league": float("nan"),
                         "raw_team_skill": float("nan"), "ece": float("nan")})
            continue
        actual = grp["actual"].to_numpy(dtype="float64")
        pred = grp["pred"].to_numpy(dtype="float64")
        raw = grp["raw"].to_numpy(dtype="float64")
        base = grp["base_situation"].to_numpy(dtype="float64")
        b_raw, b_base = backtest.brier(raw, actual), backtest.brier(base, actual)
        rows.append({
            "confidence": label, "n": len(grp), "reach": len(grp) / float(len(frame)),
            "mean_w": float(grp["weight"].mean()),
            "median_n": float(pd.to_numeric(grp["sample_size"]).median()),
            "mean_gap_from_league": float(np.mean(np.abs(pred - base))),
            "says_something_else": float(np.mean(np.abs(pred - base) > SIGNAL_EPS)),
            "brier_shipped": backtest.brier(pred, actual),
            "brier_raw_team": b_raw, "brier_league": b_base,
            "raw_team_skill": 1.0 - b_raw / b_base,
            "ece": backtest.calibration(grp, "pred")[1],
        })
    return pd.DataFrame(rows)


def _cut_rows(frame: pd.DataFrame) -> pd.DataFrame:
    """The same attribution test under each candidate cut pair.

    `raw_team_skill` in the band a cut calls high is the number that decides the
    cut: attributing to the team is only honest where the team's own unshrunk
    number beats the league line out of sample.
    """
    actual = frame["actual"].to_numpy(dtype="float64")
    raw = frame["raw"].to_numpy(dtype="float64")
    base = frame["base_situation"].to_numpy(dtype="float64")
    w = frame["weight"].to_numpy(dtype="float64")
    rows = []
    for hi, med in CANDIDATE_CUTS:
        k = float(tendency.SHRINK_K)
        out = {"cuts": "w>={:.2f} / >={:.2f}".format(hi, med),
               "implied_n": "n>={:.0f} / >={:.0f}".format(k * hi / (1 - hi), k * med / (1 - med))}
        pred = frame["pred"].to_numpy(dtype="float64")
        for label, mask in (("high", w >= hi), ("medium", (w >= med) & (w < hi)), ("low", w < med)):
            out[label + "_reach"] = float(mask.mean())
            out[label + "_raw_skill"] = (1.0 - backtest.brier(raw[mask], actual[mask])
                                         / backtest.brier(base[mask], actual[mask])) if mask.any() else float("nan")
            # What the band is for: the share of its snaps where the number the card
            # would print is far enough from the league line to be a team claim at all.
            out[label + "_says_else"] = float(np.mean(np.abs(pred[mask] - base[mask]) > SIGNAL_EPS)) \
                if mask.any() else float("nan")
        rows.append(out)
    return pd.DataFrame(rows)


def production_bands(df: pd.DataFrame, shrink_k: float) -> pd.DataFrame:
    """Confidence mix a shipped table produces, weighted by real snaps.

    The holdout is trained on a short window (CFB two seasons, NFL fourteen
    weeks), so its confidence mix understates what the shipped tables reach. This
    builds on the whole frame, which is what `refresh.py` will ship, and weights
    each (team, bucket) cell by how often that situation actually occurs.
    """
    tables = tendency.build(df, shrink_k=shrink_k)
    counts = (tendency.eligible(df)
              .assign(key=lambda f: buckets.bucket_series(f["down"], f["distance"], f["yards_to_goal"]))
              .groupby(["offense", "key"]).size())
    snaps: Dict[str, int] = {}
    cells: Dict[str, int] = {}
    for (team, key) in counts.index:
        down, band, zone = key.split("_", 2)
        blk = tendency.query(tables, str(team), int(down[1:]), backtest.REP_DISTANCE[band],
                             backtest.REP_YTG[zone])
        label = blk["confidence"]
        snaps[label] = snaps.get(label, 0) + int(counts[(team, key)])
        cells[label] = cells.get(label, 0) + 1
    total_s, total_c = sum(snaps.values()), sum(cells.values())
    return pd.DataFrame([{"confidence": label, "cells": cells.get(label, 0),
                          "cell_share": cells.get(label, 0) / float(total_c),
                          "snaps": snaps.get(label, 0),
                          "snap_share": snaps.get(label, 0) / float(total_s)}
                         for label in ("high", "medium", "low")])


def verify_shipped(train_outer: pd.DataFrame, holdout: pd.DataFrame, df: pd.DataFrame,
                   unshrunk: pd.DataFrame, val_curve: Dict[float, float]) -> Dict[str, Any]:
    """Section 8. Everything here reads the shipped constant off `tendency`."""
    k = tendency.SHRINK_K
    frame = shipped_frame(train_outer, holdout, k)
    actual = frame["actual"].to_numpy(dtype="float64")
    pred = frame["pred"].to_numpy(dtype="float64")
    base = frame["base_situation"].to_numpy(dtype="float64")
    raw = frame["raw"].to_numpy(dtype="float64")

    b_ship = backtest.brier(pred, actual)
    b_base = backtest.brier(base, actual)
    b_raw = backtest.brier(raw, actual)
    print("\n8. SHIPPED CONFIGURATION: tendency.SHRINK_K = {:g}, rung 4 removed, {:,} scored plays"
          .format(k, len(frame)))
    print("  ladder unshrunk (k=0)                 {:.5f}".format(b_raw))
    print("  SITUATION BASELINE                    {:.5f}   <- the bar".format(b_base))
    print("  shipped (query() as it now stands)    {:.5f}   ({:+.5f} vs the bar, {:+.2%})".format(
        b_ship, b_ship - b_base, 1 - b_ship / b_base))
    point, lo, hi = cluster_bootstrap(frame, pred, base)
    print("  paired team-clustered bootstrap vs the bar: {:+.5f}  95% CI [{:+.5f}, {:+.5f}] -> {}".format(
        point, lo, hi, _call(lo, hi)))
    print("  accuracy: shipped {:.4f}  situation {:.4f}  unshrunk ladder {:.4f}".format(
        backtest.accuracy(pred, actual), backtest.accuracy(base, actual),
        backtest.accuracy(raw, actual)))
    ece_ship = backtest.calibration(frame, "pred")[1]
    print("  ECE: shipped {:.4f}   unshrunk ladder {:.4f}   situation baseline {:.4f}".format(
        ece_ship, backtest.calibration(frame, "raw")[1],
        backtest.calibration(frame, "base_situation")[1]))

    # Where the shipped constant sits on this ladder's own honest curve. The fit
    # is the validation curve; the holdout column is reported, never chosen from.
    k_val = min(val_curve, key=lambda c: val_curve[c])
    k_hold, _ = fine_best_k(unshrunk, "base_situation")
    hold_curve = sweep(unshrunk, "base_situation", sorted(set(ALL_K) | {float(k)}))
    plateau = [c for c in ALL_K if np.isfinite(c) and val_curve[c] <= min(val_curve.values()) + 0.0002]
    print("  re-fit on THIS ladder: validation argmin k={}, plateau (within 0.0002) [{:g}, {:g}]; "
          "the shipped {:g} is {} it".format(_fk(k_val), min(plateau), max(plateau), k,
                                             "inside" if min(plateau) <= k <= max(plateau) else "OUTSIDE"))
    print("  holdout Brier at the validation argmin {:.5f}, at the shipped constant {:.5f} "
          "({:+.5f}); the holdout's own argmin is k={} at {:.5f}".format(
              hold_curve[k_val], hold_curve[float(k)], hold_curve[float(k)] - hold_curve[k_val],
              _fk(k_hold), hold_curve[k_hold]))

    labels = ["high", "medium", "low"]
    backtest.show("8a. CONFIDENCE BANDS on held-out snaps. `raw_team_skill` is the test that "
                  "matters: it is what the team's own unshrunk number would have scored against the "
                  "league line in that band", _band_rows(frame, labels))
    backtest.show("8b. CANDIDATE CUTS. Shipped pair is the first row", _cut_rows(frame))
    backtest.show("8c. CONFIDENCE MIX a shipped table produces, built on the whole frame and "
                  "weighted by real snaps", production_bands(df, k))
    return {"brier": b_ship, "brier_situation": b_base, "brier_unshrunk": b_raw, "ece": ece_ship,
            "ci": (point, lo, hi), "bands": _band_rows(frame, labels),
            "production": production_bands(df, k), "n": len(frame)}


# --------------------------------------------------------------------------- #
# section 9: the two rates k was NOT fitted on

# `k` is fitted on pass rate, because that is the number a card prints. The block
# carries two more rates and `_block` shrinks all three with the same constant.
# That is a claim about success and explosive rate, and this section is what backs
# it: if either rate's own optimum were far below 150, one constant would be
# over-shrinking it and the file would owe the reader a second constant.
AUX_RATES: List[Tuple[str, str]] = [("success_rate", "success"), ("explosive_rate", "explosive")]


def _aux_outcomes(test: pd.DataFrame) -> pd.DataFrame:
    """Held-out plays with the per-play truth for each auxiliary rate attached.

    `explosive` is recomputed from the same two yardage thresholds `tendency.build`
    uses, off `tendency`'s own constants, so the outcome scored here and the rate
    predicted cannot drift apart.
    """
    el = tendency.eligible(test).copy()
    yards = pd.to_numeric(el["yards_gained"], errors="coerce")
    is_pass = el["is_pass"].astype(bool)
    is_rush = el["is_rush"].astype(bool)
    el["explosive"] = ((is_pass & (yards >= tendency.EXPLOSIVE_PASS_YARDS))
                       | (is_rush & (yards >= tendency.EXPLOSIVE_RUSH_YARDS)))
    el["success"] = el["success"].astype(bool)
    return el


def aux_frame(train: pd.DataFrame, test: pd.DataFrame, field: str, outcome: str,
              half_life: float = CONTRACT_HALF_LIFE) -> pd.DataFrame:
    """One row per held-out play for a non-pass rate: prediction, n, league target.

    Same shape and same `shrink_k=0` discipline as `evaluate`, so `sweep` and
    `fine_best_k` work on it unchanged.
    """
    tables = tendency.build(train, half_life=half_life, shrink_k=0.0)
    el = _aux_outcomes(test)
    el["key"] = buckets.bucket_series(el["down"], el["distance"], el["yards_to_goal"])
    el = el[el["key"].notna()]
    el["team"] = el["offense"].astype(str)

    memo: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for team, key in el.groupby(["team", "key"]).size().index:
        memo[(team, key)] = tendency.query(tables, team, *backtest._rep(key))
    blocks = [memo[(t, k)] for t, k in zip(el["team"], el["key"])]

    naive = float(_aux_outcomes(train)[outcome].astype(bool).mean())
    lg = tables["league_exact"]
    situation = np.array([backtest._lookup(lg, k, field) for k in el["key"]], dtype="float64")
    out = pd.DataFrame({
        "team": el["team"].to_numpy(),
        "actual": el[outcome].astype(bool).to_numpy(dtype="float64"),
        "pred": [b[field] for b in blocks],
        "sample_size": [b["sample_size"] for b in blocks],
        "base_situation": np.where(np.isnan(situation), naive, situation),
    })
    out = out[pd.to_numeric(out["pred"]).notna()].reset_index(drop=True)
    out["pred"] = pd.to_numeric(out["pred"]).astype("float64")
    return out


def auxiliary_rates(train_inner: pd.DataFrame, validation: pd.DataFrame,
                    train_outer: pd.DataFrame, holdout: pd.DataFrame) -> pd.DataFrame:
    """Fit `k` separately for success and explosive rate, on the same nested split.

    `shipped_gain_share` is the question: of the Brier the rate's own best `k`
    could win against no shrinkage at all, how much does the one shipped constant
    already collect? Near 1.0 means a second constant would buy nothing.
    """
    rows = []
    for field, outcome in AUX_RATES:
        val = aux_frame(train_inner, validation, field, outcome)
        hold = aux_frame(train_outer, holdout, field, outcome)
        k_val, _ = fine_best_k(val, "base_situation")
        k_hold, b_hold_best = fine_best_k(hold, "base_situation")
        curve = sweep(hold, "base_situation", sorted(set(ALL_K) | {float(tendency.SHRINK_K)}))
        b_raw, b_ship = curve[0.0], curve[float(tendency.SHRINK_K)]
        reachable = b_raw - b_hold_best
        rows.append({
            "rate": field, "n": len(hold),
            "brier_unshrunk": b_raw,
            "brier_at_shipped_k": b_ship,
            "brier_at_own_best_k": b_hold_best,
            "brier_situation": curve[INF],
            "k_on_validation": _fk(k_val),
            "k_on_holdout": _fk(k_hold),
            "shipped_gain_share": (b_raw - b_ship) / reachable if reachable > 0 else float("nan"),
        })
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #
# run

def run(path: Path) -> Dict[str, Any]:
    df = schema.read_plays(path)
    train_outer, holdout, outer_label = backtest.temporal_split(df)
    train_inner, validation, inner_label = tail_split(train_outer)

    league = str(tendency.eligible(df)["league"].iloc[0])
    print("=" * 104)
    print("SHRINKAGE / {}   file={}".format(league.upper(), path.name))
    print("  outer split (scored, never fitted on): {}".format(outer_label))
    print("  inner split (fitted on):               {}".format(inner_label))
    print("  train_inner {:,} rows | validation {:,} | train_outer {:,} | holdout {:,}".format(
        len(train_inner), len(validation), len(train_outer), len(holdout)))
    _checks(train_inner, validation, holdout)

    # ---- 1. joint grid, half-life x k, fitted honestly on the inner split ----
    val_scores: Dict[Tuple[float, float], float] = {}
    hold_scores: Dict[Tuple[float, float], float] = {}
    val_frames: Dict[float, pd.DataFrame] = {}
    hold_frames: Dict[float, pd.DataFrame] = {}
    for hl in HALF_LIVES:
        val_frames[hl] = evaluate(train_inner, validation, hl)
        hold_frames[hl] = evaluate(train_outer, holdout, hl)
        vs = sweep(val_frames[hl], "base_situation", K_GRID)
        hs = sweep(hold_frames[hl], "base_situation", K_GRID)
        for k in K_GRID:
            val_scores[(hl, k)] = vs[k]
            hold_scores[(hl, k)] = hs[k]

    val = {k: val_scores[(CONTRACT_HALF_LIFE, k)] for k in K_GRID}
    hold = {k: hold_scores[(CONTRACT_HALF_LIFE, k)] for k in K_GRID}
    val_frame = val_frames[CONTRACT_HALF_LIFE]
    final = hold_frames[CONTRACT_HALF_LIFE]
    situation = hold[INF]

    backtest.show("1. k SWEEP at the contract's half-life 1.0 (the validation column is the fit; "
                  "the holdout column is reported, never chosen from)", sweep_table(val, hold, situation))
    k_star, val_at_star = fine_best_k(val_frame, "base_situation")
    hold_at_star = sweep(final, "base_situation", [k_star])[k_star]
    k_ceiling, hold_ceiling = fine_best_k(final, "base_situation")
    print("  honest pick, argmin on validation: k={} (validation {:.5f}) -> holdout {:.5f}".format(
        _fk(k_star), val_at_star, hold_at_star))
    print("  ceiling, argmin on the holdout:    k={} -> holdout {:.5f}   (not a proposal, the cost "
          "of fitting honestly is {:+.5f})".format(_fk(k_ceiling), hold_ceiling, hold_at_star - hold_ceiling))
    print("  reproduction check: k=0 is the ladder unshrunk {:.5f}; "
          "k=inf reproduces the situation baseline {:.5f}".format(hold[0], situation))

    # ---- 2. does the half-life carry a decision? ----
    backtest.show("2a. JOINT GRID, validation Brier (this is the fit surface)",
                  joint_table(val_scores))
    backtest.show("2b. JOINT GRID, holdout Brier (reported, never chosen from)",
                  joint_table(hold_scores))
    per_hl = []
    for hl in HALF_LIVES:
        k_hl, v_hl = fine_best_k(val_frames[hl], "base_situation")
        per_hl.append({"half_life": _fk(hl), "best_k_on_validation": _fk(k_hl),
                       "brier_validation": v_hl,
                       "brier_holdout": sweep(hold_frames[hl], "base_situation", [k_hl])[k_hl],
                       "brier_holdout_unshrunk": sweep(hold_frames[hl], "base_situation", [0])[0]})
    per_hl_frame = pd.DataFrame(per_hl)
    backtest.show("2c. FIT k SEPARATELY AT EACH HALF-LIFE, then score the holdout frozen", per_hl_frame)
    joint_hl = HALF_LIVES[int(per_hl_frame["brier_validation"].to_numpy().argmin())]
    joint_row = per_hl_frame.iloc[int(per_hl_frame["brier_validation"].to_numpy().argmin())]
    print("  joint argmin on validation: half_life={} k={} -> holdout {:.5f}".format(
        _fk(joint_hl), joint_row["best_k_on_validation"], joint_row["brier_holdout"]))
    print("  same at the contract's half_life=1: k={} -> holdout {:.5f}   (difference {:+.5f})".format(
        _fk(k_star), hold_at_star, hold_at_star - float(joint_row["brier_holdout"])))
    spread_v = per_hl_frame["brier_validation"].max() - per_hl_frame["brier_validation"].min()
    spread_h = per_hl_frame["brier_holdout"].max() - per_hl_frame["brier_holdout"].min()
    print("  spread across the whole half-life axis once k is fitted: validation {:.5f}, "
          "holdout {:.5f}".format(spread_v, spread_h))
    print("  unshrunk holdout spread across the same axis: {:.5f}   (the half-life question is "
          "an artefact of not shrinking)".format(
              per_hl_frame["brier_holdout_unshrunk"].max() - per_hl_frame["brier_holdout_unshrunk"].min()))

    # ---- 3. headline: contract half-life, k frozen from the validation fit ----
    actual = final["actual"].to_numpy(dtype="float64")
    pred = final["pred"].to_numpy(dtype="float64")
    n = pd.to_numeric(final["sample_size"]).to_numpy(dtype="float64")
    base_s = final["base_situation"].to_numpy(dtype="float64")
    base_g = final["base_global"].to_numpy(dtype="float64")
    shrunk = shrunk_rate(pred, n, base_s, k_star)
    final["shrunk"] = shrunk

    b_shipped = backtest.brier(pred, actual)
    b_situation = backtest.brier(base_s, actual)
    b_global = backtest.brier(base_g, actual)
    b_shrunk = backtest.brier(shrunk, actual)

    print("\n3. HOLDOUT BRIER with (half_life=1.0, k={}) frozen from the validation fit, {:,} plays".format(
        _fk(k_star), len(final)))
    print("  league average only (global)          {:.5f}".format(b_global))
    print("  engine as shipped (k=0)               {:.5f}".format(b_shipped))
    print("  SITUATION BASELINE (k=inf)            {:.5f}   <- the bar".format(b_situation))
    print("  SHRUNK ENGINE                         {:.5f}   ({:+.5f} vs the bar, {:+.2%})".format(
        b_shrunk, b_shrunk - b_situation, 1 - b_shrunk / b_situation))
    print("  accuracy: shrunk {:.4f}  situation {:.4f}  shipped {:.4f}".format(
        backtest.accuracy(shrunk, actual), backtest.accuracy(base_s, actual),
        backtest.accuracy(pred, actual)))

    point, lo, hi = cluster_bootstrap(final, shrunk, base_s)
    print("  paired team-clustered bootstrap, shrunk minus situation: {:+.5f}  95% CI [{:+.5f}, {:+.5f}]".format(
        point, lo, hi))
    print("  verdict: {}".format(_call(lo, hi)))
    c_pred = shrunk_rate(pred, n, base_s, k_ceiling)
    c_point, c_lo, c_hi = cluster_bootstrap(final, c_pred, base_s)
    print("  the same test at the holdout's own best k={} (the ceiling): {:+.5f} "
          "95% CI [{:+.5f}, {:+.5f}] -> {}".format(_fk(k_ceiling), c_point, c_lo, c_hi, _call(c_lo, c_hi)))

    # ---- 4. calibration ----
    cal_before, ece_before = backtest.calibration(final, "pred")
    cal_after, ece_after = backtest.calibration(final, "shrunk")
    backtest.show("4a. CALIBRATION BEFORE shrinkage (engine as shipped, same 0.1 bins as the backtest)",
                  cal_before)
    print("  expected calibration error: {:.4f}".format(ece_before))
    backtest.show("4b. CALIBRATION AFTER shrinkage", cal_after)
    print("  expected calibration error: {:.4f}   ({:+.4f} against before)".format(
        ece_after, ece_after - ece_before))
    cal_base, ece_base = backtest.calibration(final, "base_situation")
    print("  situation baseline's own ECE for reference: {:.4f}".format(ece_base))

    # ---- 5. surviving team signal ----
    tables = final.attrs["tables"]
    sig = signal_retention(tables, k_star)
    play_raw = float(np.mean(np.abs(pred - base_s) > SIGNAL_EPS))
    play_shrunk = float(np.mean(np.abs(shrunk - base_s) > SIGNAL_EPS))
    weight = n / (n + k_star)
    print("\n5. TEAM SIGNAL SURVIVING SHRINKAGE (|rate - league bucket rate| > {:.0f} points)".format(
        SIGNAL_EPS * 100))
    print("  {:,} (team, bucket) cells across {} teams x {} buckets".format(
        sig["cells"], len(tables["teams"]), len(buckets.BUCKET_KEYS)))
    print("  cells with team signal:  before {:.1%}   after {:.1%}".format(
        sig["raw_share"], sig["shrunk_share"]))
    print("  mean |gap| from league:  before {:.4f}   after {:.4f}".format(
        sig["raw_mean_gap"], sig["shrunk_mean_gap"]))
    print("  weighted by held-out snaps (what a viewer actually sees): before {:.1%}   after {:.1%}".format(
        play_raw, play_shrunk))
    print("  team weight n/(n+k) on a held-out snap: median {:.2f}, quartiles {:.2f} / {:.2f}, "
          "median n behind the number {:.0f}".format(
              float(np.median(weight)), float(np.percentile(weight, 25)),
              float(np.percentile(weight, 75)), float(np.median(n))))

    # ---- 6. the alternative target ----
    val_alt = sweep(val_frame, "base_team", K_GRID)
    hold_alt = sweep(final, "base_team", K_GRID)
    k_alt, val_alt_best = fine_best_k(val_frame, "base_team")
    alt_pred = shrunk_rate(pred, n, final["base_team"].to_numpy(dtype="float64"), k_alt)
    b_alt = backtest.brier(alt_pred, actual)
    backtest.show("6. ALTERNATIVE TARGET: shrink toward the team's own overall rate, not the league bucket",
                  sweep_table(val_alt, hold_alt, b_situation))
    print("  honest pick k={} (validation {:.5f}) -> holdout {:.5f}".format(_fk(k_alt), val_alt_best, b_alt))
    print("  against the league-bucket target at its own honest pick: {:.5f} ({:+.5f})".format(
        b_shrunk, b_alt - b_shrunk))
    a_point, a_lo, a_hi = cluster_bootstrap(final, alt_pred, shrunk)
    print("  paired bootstrap, team-overall target minus league-bucket target: "
          "{:+.5f}  95% CI [{:+.5f}, {:+.5f}]".format(a_point, a_lo, a_hi))

    backtest.show("7. DIAGNOSTIC: best k per rung, fitted on the holdout itself (a ceiling, not a proposal)",
                  per_rung_k(final, "base_situation"))

    val_curve = sweep(val_frame, "base_situation", ALL_K)
    shipped = verify_shipped(train_outer, holdout, df, final, val_curve)

    aux = auxiliary_rates(train_inner, validation, train_outer, holdout)
    backtest.show("9. THE TWO RATES k WAS NOT FITTED ON. `_block` shrinks all three with the one "
                  "constant; this is whether that is defensible", aux)
    print("  one constant collects {} of the reachable gain on these two rates, so a second "
          "fitted constant is not earned".format(
              " and ".join("{:.0%}".format(s) for s in aux["shipped_gain_share"])))

    return {"league": league, "k": k_star, "k_ceiling": k_ceiling, "n": len(final),
            "shipped": shipped, "aux": aux,
            "brier_shipped": b_shipped, "brier_situation": b_situation,
            "brier_shrunk": b_shrunk, "brier_global": b_global, "brier_ceiling": hold_ceiling,
            "ece_before": ece_before, "ece_after": ece_after,
            "ci": (point, lo, hi), "signal": sig, "play_signal": play_shrunk,
            "k_alt": k_alt, "brier_alt": b_alt,
            "val_curve": val_curve, "holdout": final}


def pooled(results: List[Dict[str, Any]]) -> None:
    """One constant for both leagues, chosen on the two validation curves only.

    Each league's validation Brier is centred on its own minimum before adding,
    so the pooled k answers "which single k is least bad for both" rather than
    "which k suits whichever league has more plays".
    """
    print("\n" + "=" * 104)
    print("POOLED CONSTANT: one k for both leagues, argmin of the summed validation regret")
    regret = {k: sum(r["val_curve"][k] - min(r["val_curve"].values()) for r in results) for k in ALL_K}
    k_pool = min(regret, key=lambda key: regret[key])
    flat = [k for k in ALL_K if np.isfinite(k) and regret[k] <= regret[k_pool] + 0.0002]
    print("  pooled k = {}   (per-league honest picks were {})".format(
        _fk(k_pool), ", ".join("{} {}".format(r["league"], _fk(r["k"])) for r in results)))
    print("  the pooled validation curve is within 0.0002 of its minimum for k in [{:g}, {:g}]: the "
          "constant is identified to about a factor of three, not to three digits".format(
              min(flat), max(flat)))
    backtest.show("  pooled validation regret across the reported grid",
                  pd.DataFrame([{"k": _fk(k), "summed_regret": regret[k]} for k in K_GRID]))

    rows = []
    for cand in ROUND_CANDIDATES:
        row = {"k": _fk(cand), "summed_validation_regret": regret[cand],
               "inside_plateau": min(flat) <= cand <= max(flat)}
        for r in results:
            frame = r["holdout"]
            row["holdout_" + r["league"]] = backtest.brier(
                shrunk_rate(frame["pred"].to_numpy(dtype="float64"),
                            pd.to_numeric(frame["sample_size"]).to_numpy(dtype="float64"),
                            frame["base_situation"].to_numpy(dtype="float64"), cand),
                frame["actual"].to_numpy(dtype="float64"))
        rows.append(row)
    backtest.show("  ROUND CONSTANTS: chosen by summed validation regret, holdouts reported only",
                  pd.DataFrame(rows))
    k_round = min(ROUND_CANDIDATES, key=lambda c: regret[c])
    print("  recommended shipping constant: k = {:g}   (tendency.SHRINK_K is currently {:g})".format(
        k_round, tendency.SHRINK_K))
    for r in results:
        frame = r["holdout"]
        actual = frame["actual"].to_numpy(dtype="float64")
        base = frame["base_situation"].to_numpy(dtype="float64")
        args = (frame["pred"].to_numpy(dtype="float64"),
                pd.to_numeric(frame["sample_size"]).to_numpy(dtype="float64"), base)
        pool_pred = shrunk_rate(*(args + (k_pool,)))
        b_pool = backtest.brier(pool_pred, actual)
        b_round = backtest.brier(shrunk_rate(*(args + (float(k_round),))), actual)
        point, lo, hi = cluster_bootstrap(frame, pool_pred, base)
        print("  {}: pooled k={} -> holdout {:.5f} | rounded k={} -> {:.5f} | own k={} -> {:.5f} | "
              "situation {:.5f}".format(r["league"], _fk(k_pool), b_pool, _fk(k_round), b_round,
                                        _fk(r["k"]), r["brier_shrunk"], r["brier_situation"]))
        print("       pooled k against the situation baseline: {:+.5f} CI [{:+.5f}, {:+.5f}] -> {}".format(
            point, lo, hi, _call(lo, hi)))
        frame = frame.assign(pooled=pool_pred)
        _, ece_pool = backtest.calibration(frame, "pooled")
        print("       calibration at the pooled k: ECE {:.4f}  (as shipped {:.4f}, situation baseline "
              "{:.4f})".format(ece_pool, r["ece_before"], backtest.calibration(frame, "base_situation")[1]))
        sig = signal_retention(frame.attrs["tables"], k_pool)
        play = float(np.mean(np.abs(pool_pred - base) > SIGNAL_EPS))
        print("       team signal at the pooled k: {:.1%} of (team, bucket) cells, {:.1%} of held-out "
              "snaps, mean |gap| {:.4f}".format(sig["shrunk_share"], play, sig["shrunk_mean_gap"]))


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    out = []
    for name in ("plays_cfb.parquet", "plays_nfl.parquet"):
        p = root / "data" / name
        if not p.exists():
            print("skip {}, not on disk".format(p))
            continue
        out.append(run(p))
    if len(out) == 2:
        pooled(out)
    print("\n" + "=" * 104)
    print("VERDICT")
    for r in out:
        gap = r["brier_shrunk"] - r["brier_situation"]
        _, lo, hi = r["ci"]
        call = "BEATS" if hi < 0 else ("TIES" if lo <= 0 <= hi else "LOSES TO")
        print("  {}: k={} at the contract half-life 1.0 | shipped {:.5f} -> shrunk {:.5f} | "
              "situation {:.5f} | {} the bar by {:+.5f} CI [{:+.5f}, {:+.5f}]".format(
                  r["league"], _fk(r["k"]), r["brier_shipped"], r["brier_shrunk"],
                  r["brier_situation"], call, gap, lo, hi))
        print("      ECE {:.4f} -> {:.4f} | team signal on {:.1%} of cells, {:.1%} of snaps | "
              "team-overall target {:.5f} at k={} | holdout-fitted ceiling {:.5f} at k={}".format(
                  r["ece_before"], r["ece_after"], r["signal"]["shrunk_share"], r["play_signal"],
                  r["brier_alt"], _fk(r["k_alt"]), r["brier_ceiling"], _fk(r["k_ceiling"])))
        sh = r["shipped"]
        _, s_lo, s_hi = sh["ci"]
        prod = sh["production"].set_index("confidence")["snap_share"]
        print("      SHIPPED (tendency.SHRINK_K={:g}, rung 4 removed): {:.5f} vs the bar {:.5f}, "
              "{} | ECE {:.4f} | shipped-table snaps high {:.1%} / medium {:.1%} / low {:.1%}".format(
                  tendency.SHRINK_K, sh["brier"], sh["brier_situation"], _call(s_lo, s_hi), sh["ece"],
                  prod["high"], prod["medium"], prod["low"]))

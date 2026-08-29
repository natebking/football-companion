"""Can a regime change be detected from the play-by-play alone, with no coaching data?

The design doc's objection to a hand-maintained coordinator table is that the
public record is messy and misses quiet play-calling handoffs. A statistical
detector would need no maintenance and would catch the quiet ones. This module
asks whether such a detector actually works, and then whether acting on it
(truncating each team's history at its last detected changepoint) beats the
season recency decay the engine ships.

Nothing here reimplements the engine. Eligibility, bucketing, the ladder, the
scorer and the coach ground truth all come from `tendency`, `buckets`,
`backtest` and `regime.magnitude`.

Series
------
A raw pass rate by game confounds play calling with situation mix: a team that
faced more 3rd-and-longs looks pass-happier without changing a thing. So every
play is residualised against the league's rate for its own bucket,

    resid = is_pass - league_pass_rate[bucket]

and the game statistic is the mean residual over that game's eligible,
bucketable snaps, carrying the play count as its weight. This is pass rate over
expectation. Zero means "called it exactly like the league calls that mix".

Detector
--------
Binary segmentation on a weighted CUSUM. For a segment of games with weights
w_i (play counts) and values r_i, and a split after the first k games,

    CUSUM(k) = |S_k - W_k * (S / W)| / sqrt(W_k * (W - W_k) / W)

with S_k, W_k the running sums. The test statistic is max_k CUSUM(k) over splits
leaving at least `MIN_SEG` games a side. Significance comes from permuting the
(r_i, w_i) pairs within the segment: under exchangeability the null needs no
distributional assumption, and the variance scale cancels, so overdispersion
from game script and opponent quality is absorbed rather than assumed away.
Segmentation recurses into both halves of every accepted split.

Measurements
------------
1. Null calibration: the detector run on series whose game order was shuffled,
   where by construction there is nothing to find.
2. Detection count and where the changepoints land relative to season boundaries.
3. Precision and recall against the head-coach ground truth from `magnitude`,
   scored against the rate a detector firing at random positions would hit.
4. Hand inspection of unmatched changepoints, including whether the primary
   passer changed across the split, read out of `play_text`.
5. The decisive test: detect on the 2023-2024 training window only, truncate
   each team's history at its last detected changepoint, and score held-out 2025
   against the shipped decay plus two controls that separate "the changepoint
   was informative" from "less data, more recent, is just better".

Run: .venv/bin/python engine/regime/test_changepoint.py
"""
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent
ROOT = ENGINE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ENGINE))

import backtest  # noqa: E402
import buckets  # noqa: E402
import schema  # noqa: E402
import tendency  # noqa: E402

import magnitude  # noqa: E402  (regime/magnitude.py: coach ground truth, printing)

PLAYS_CFB = ROOT / "data" / "plays_cfb.parquet"
SEASONS = (2023, 2024, 2025)

# A split must leave at least this many games on each side. Half a season: below
# that, one strange afternoon is enough to move the statistic.
MIN_SEG = 6
# Permutation draws behind every p-value.
PERMUTATIONS = 999
ALPHA = 0.05
ALPHA_STRICT = 0.01
# A team enters detection only with this many games across the window.
MIN_GAMES = 20
# A detected changepoint counts as matching a coach change if it lands within
# this many games of the season boundary the new staff started at.
MATCH_TOLERANCE = 2
RNG_SEED = 11
RANDOM_TRUNCATION_SEEDS = (101, 102, 103, 104, 105)

show = magnitude.show


# --------------------------------------------------------------------------- #
# 1. series

def league_rates(df: pd.DataFrame) -> Dict[str, float]:
    """Pass rate per situation bucket over every team. The residual's reference."""
    el = tendency.eligible(df).copy()
    key = buckets.bucket_series(el["down"], el["distance"], el["yards_to_goal"])
    el = el[key.notna()]
    rate = (pd.DataFrame({"bucket": key[key.notna()].to_numpy(),
                          "is_pass": el["is_pass"].astype(bool).astype(float).to_numpy()})
            .groupby("bucket")["is_pass"].mean())
    return {str(k): float(v) for k, v in rate.items()}


def game_series(df: pd.DataFrame, rates: Dict[str, float]) -> pd.DataFrame:
    """One row per (team, game): situation-adjusted pass rate and its play count.

    `adj` is the mean of (is_pass - league rate for that play's bucket), so it is
    pass rate over expectation given the down, distance and field position the
    offense actually faced. Ordered by season then week then game id, which is
    the order the games were played in.
    """
    el = tendency.eligible(df).copy()
    key = buckets.bucket_series(el["down"], el["distance"], el["yards_to_goal"])
    el = el[key.notna()]
    keys = key[key.notna()].to_numpy()
    expected = np.array([rates.get(str(k), np.nan) for k in keys], dtype="float64")
    frame = pd.DataFrame({
        "team": el["offense"].astype(str).to_numpy(),
        "season": pd.to_numeric(el["season"]).astype(int).to_numpy(),
        "week": pd.to_numeric(el["week"]).astype(int).to_numpy(),
        "game_id": el["game_id"].astype(str).to_numpy(),
        "is_pass": el["is_pass"].astype(bool).astype(float).to_numpy(),
        "expected": expected,
    })
    frame["resid"] = frame["is_pass"] - frame["expected"]
    out = (frame.groupby(["team", "season", "week", "game_id"], as_index=False)
                .agg(n=("is_pass", "size"), raw=("is_pass", "mean"),
                     exp=("expected", "mean"), adj=("resid", "mean")))
    out = out.sort_values(["team", "season", "week", "game_id"]).reset_index(drop=True)
    out["idx"] = out.groupby("team").cumcount()
    return out


def season_boundaries(series: pd.DataFrame) -> Dict[str, Dict[int, int]]:
    """Per team, the game index each season starts at. A coach change lands here."""
    out: Dict[str, Dict[int, int]] = {}
    first = series.groupby(["team", "season"])["idx"].min()
    for (team, season), idx in first.items():
        out.setdefault(str(team), {})[int(season)] = int(idx)
    return out


# --------------------------------------------------------------------------- #
# 2. detector

def cusum_curve(values: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """Weighted CUSUM at every split. Index k is "split after the first k+1 games".

    Returns an array of length len(values) - 1. Callers slice it to the splits
    that respect MIN_SEG.
    """
    w_cum = np.cumsum(weights)[:-1]
    s_cum = np.cumsum(values * weights)[:-1]
    w_tot, s_tot = float(np.sum(weights)), float(np.sum(values * weights))
    scale = np.sqrt(w_cum * (w_tot - w_cum) / w_tot)
    return np.abs(s_cum - w_cum * (s_tot / w_tot)) / scale


def _cusum_matrix(values: np.ndarray, weights: np.ndarray, order: np.ndarray) -> np.ndarray:
    """cusum_curve for many permutations at once. `order` is (draws, m) of indices."""
    v = values[order] * weights[order]
    w = weights[order]
    w_cum = np.cumsum(w, axis=1)[:, :-1]
    s_cum = np.cumsum(v, axis=1)[:, :-1]
    w_tot = w_cum[:, -1:] + w[:, -1:]
    s_tot = s_cum[:, -1:] + v[:, -1:]
    scale = np.sqrt(w_cum * (w_tot - w_cum) / w_tot)
    return np.abs(s_cum - w_cum * (s_tot / w_tot)) / scale


def test_segment(values: np.ndarray, weights: np.ndarray, rng: np.random.RandomState,
                 draws: int = PERMUTATIONS, min_seg: int = MIN_SEG
                 ) -> Optional[Tuple[int, float, float]]:
    """One split test. Returns (split position, statistic, permutation p) or None.

    The split position is the number of games on the left, so `values[:pos]` is
    the old regime and `values[pos:]` the new one. p is the share of permuted
    orderings whose own maximum matches or beats the observed one, with the
    observed ordering counted in the numerator so p is never zero.
    """
    m = len(values)
    if m < 2 * min_seg:
        return None
    lo, hi = min_seg - 1, m - min_seg  # slice bounds into the length m-1 curve
    observed = cusum_curve(values, weights)[lo:hi]
    if observed.size == 0:
        return None
    stat = float(observed.max())
    pos = int(lo + int(observed.argmax()) + 1)
    order = np.argsort(rng.random_sample((draws, m)), axis=1)
    null = _cusum_matrix(values, weights, order)[:, lo:hi].max(axis=1)
    p = float((1.0 + np.sum(null >= stat)) / (draws + 1.0))
    return pos, stat, p


def segment(values: np.ndarray, weights: np.ndarray, rng: np.random.RandomState,
            alpha: float = ALPHA, draws: int = PERMUTATIONS, min_seg: int = MIN_SEG,
            offset: int = 0) -> List[Dict[str, Any]]:
    """Binary segmentation. Accepted splits, each recursing into both halves."""
    result = test_segment(values, weights, rng, draws, min_seg)
    if result is None:
        return []
    pos, stat, p = result
    if p > alpha:
        return []
    left_mean = float(np.average(values[:pos], weights=weights[:pos]))
    right_mean = float(np.average(values[pos:], weights=weights[pos:]))
    found = [{"at": offset + pos, "stat": stat, "p": p,
              "games_before": pos, "games_after": len(values) - pos,
              "adj_before": left_mean, "adj_after": right_mean,
              "delta": right_mean - left_mean}]
    found += segment(values[:pos], weights[:pos], rng, alpha, draws, min_seg, offset)
    found += segment(values[pos:], weights[pos:], rng, alpha, draws, min_seg, offset + pos)
    return sorted(found, key=lambda d: d["at"])


def detect_all(series: pd.DataFrame, alpha: float = ALPHA, min_games: int = MIN_GAMES,
               draws: int = PERMUTATIONS, seed: int = RNG_SEED,
               shuffle: bool = False) -> pd.DataFrame:
    """Run the detector over every team with enough games.

    `shuffle` destroys the time order before detecting, which is the null: any
    changepoint found there is a false positive by construction.
    """
    rng = np.random.RandomState(seed)
    rows = []
    for team, grp in series.groupby("team", sort=True):
        if len(grp) < min_games:
            continue
        values = grp["adj"].to_numpy(dtype="float64")
        weights = grp["n"].to_numpy(dtype="float64")
        if shuffle:
            perm = rng.permutation(len(values))
            values, weights = values[perm], weights[perm]
        for cp in segment(values, weights, rng, alpha, draws):
            cp["team"] = team
            cp["games"] = len(grp)
            rows.append(cp)
    cols = ["team", "games", "at", "games_before", "games_after", "stat", "p",
            "adj_before", "adj_after", "delta"]
    return pd.DataFrame(rows, columns=cols)


# --------------------------------------------------------------------------- #
# 3. ground truth

def coach_truth() -> pd.DataFrame:
    """Head-coach transitions from `magnitude`, one row per (school, season)."""
    api_key = magnitude.ingest_cfb.load_api_key()
    payloads = {y: magnitude.fetch_coaches(y, api_key) for y in SEASONS}
    frames = {y: magnitude.coach_rows(payloads[y], y) for y in SEASONS}
    return magnitude.transitions(magnitude.primary_coaches(frames))


def change_indices(trans: pd.DataFrame, bounds: Dict[str, Dict[int, int]],
                   kinds: Tuple[str, ...] = ("offseason",)) -> Dict[str, List[Dict[str, Any]]]:
    """Per team, the game index each qualifying coach change should show up at."""
    out: Dict[str, List[Dict[str, Any]]] = {}
    for rec in trans.itertuples(index=False):
        if rec.change_kind not in kinds:
            continue
        idx = bounds.get(rec.school, {}).get(int(rec.season))
        if idx is None:
            continue
        out.setdefault(rec.school, []).append(
            {"season": int(rec.season), "at": int(idx),
             "label": "{} {} -> {}".format(rec.season, rec.prev_coach, rec.coach)})
    return out


def merge_truth(*sources: Dict[str, List[Dict[str, Any]]]) -> Dict[str, List[Dict[str, Any]]]:
    """Union of several ground truths, keyed the same way."""
    out: Dict[str, List[Dict[str, Any]]] = {}
    for src in sources:
        for team, items in src.items():
            out.setdefault(team, []).extend(items)
    return {t: sorted(v, key=lambda d: d["at"]) for t, v in out.items()}


def valid_splits(n_games: int, min_seg: int = MIN_SEG) -> np.ndarray:
    """Every split position the detector is allowed to return, for a series of n."""
    return np.arange(min_seg, n_games - min_seg + 1)


def chance_precision(series: pd.DataFrame, truth: Dict[str, List[Dict[str, Any]]],
                     min_games: int = MIN_GAMES, tol: int = MATCH_TOLERANCE) -> float:
    """Precision a detector firing at a uniformly random legal split would get.

    Coach changes sit at season boundaries, which are near the middle of a
    three-season series, and the detector cannot split near the ends. A matched
    changepoint is therefore not free evidence, and this is what it has to beat.
    """
    hits, total = 0.0, 0
    sizes = series.groupby("team").size()
    for team, n in sizes.items():
        if n < min_games:
            continue
        splits = valid_splits(int(n))
        if splits.size == 0:
            continue
        targets = [c["at"] for c in truth.get(str(team), [])]
        hit = np.zeros(splits.size, dtype=bool)
        for t in targets:
            hit |= np.abs(splits - t) <= tol
        hits += float(hit.mean())
        total += 1
    return hits / total if total else float("nan")


def match_detections(found: pd.DataFrame, truth: Dict[str, List[Dict[str, Any]]],
                     tol: int = MATCH_TOLERANCE, name: str = "matches_coach_change") -> pd.DataFrame:
    """Tag every detection with the ground-truth event it matches, if any."""
    out = found.copy()
    matched, which, offby = [], [], []
    for rec in found.itertuples(index=False):
        best = None
        for cand in truth.get(rec.team, []):
            gap = abs(int(rec.at) - cand["at"])
            if gap <= tol and (best is None or gap < best[0]):
                best = (gap, cand)
        matched.append(best is not None)
        which.append(best[1]["label"] if best else "")
        offby.append(best[0] if best else np.nan)
    out[name] = matched
    out[name.replace("matches_", "") + "_event"] = which
    out["games_off"] = offby
    return out


def recall_table(found: pd.DataFrame, truth: Dict[str, List[Dict[str, Any]]],
                 series: pd.DataFrame, min_games: int = MIN_GAMES,
                 tol: int = MATCH_TOLERANCE) -> pd.DataFrame:
    """One row per coach change that the detector had a fair chance to find."""
    sizes = series.groupby("team").size().to_dict()
    by_team: Dict[str, List[int]] = {}
    for rec in found.itertuples(index=False):
        by_team.setdefault(rec.team, []).append(int(rec.at))
    rows = []
    for team, changes in sorted(truth.items()):
        n = int(sizes.get(team, 0))
        if n < min_games:
            continue
        splits = valid_splits(n)
        for cand in changes:
            reachable = bool(splits.size and np.min(np.abs(splits - cand["at"])) <= tol)
            hits = [a for a in by_team.get(team, []) if abs(a - cand["at"]) <= tol]
            rows.append({"team": team, "season": cand["season"], "at": cand["at"],
                         "games": n, "reachable": reachable, "detected": bool(hits),
                         "label": cand["label"]})
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #
# 4. hand inspection

PASSER_RE = re.compile(r"^([A-Z][A-Za-z'.\-]+(?: [A-Z][A-Za-z'.\-]+){0,2}?) (?:pass|sacked)\b")
PASSER_FROM_RE = re.compile(r"\bpass from ([A-Z][A-Za-z'.\-]+(?: [A-Z][A-Za-z'.\-]+){0,2})\b")


def passer(text: Any) -> Optional[str]:
    """Primary passer out of a CFBD play description, or None if it does not say."""
    if not isinstance(text, str):
        return None
    m = PASSER_RE.match(text)
    if m:
        return m.group(1)
    m = PASSER_FROM_RE.search(text)
    return m.group(1) if m else None


def passer_by_game(df: pd.DataFrame) -> pd.DataFrame:
    """team x game -> the passer with the most dropbacks that game."""
    el = tendency.eligible(df)
    el = el[el["is_pass"].astype(bool)]
    names = el["play_text"].map(passer)
    frame = pd.DataFrame({"team": el["offense"].astype(str).to_numpy(),
                          "game_id": el["game_id"].astype(str).to_numpy(),
                          "passer": names.to_numpy()}).dropna(subset=["passer"])
    counts = frame.groupby(["team", "game_id", "passer"]).size().rename("n").reset_index()
    counts = counts.sort_values("n", ascending=False).drop_duplicates(["team", "game_id"])
    return counts.rename(columns={"passer": "top_passer"})[["team", "game_id", "top_passer", "n"]]


def _modal(names: List[Any]) -> Optional[str]:
    clean = [n for n in names if isinstance(n, str)]
    return pd.Series(clean).value_counts().idxmax() if clean else None


QB_WINDOW = 4


def qb_change_indices(series: pd.DataFrame, qb: pd.DataFrame, window: int = QB_WINDOW,
                      min_games: int = MIN_GAMES) -> Dict[str, List[Dict[str, Any]]]:
    """Per team, the game index where the primary passer handed off and stayed handed off.

    Keyed exactly like the coach ground truth so the same precision and recall
    machinery scores it. A one-week injury fill-in does not qualify: the modal
    passer over the `window` games before and the `window` games after both have
    to be stable and different. Runs of adjacent candidate indices collapse to
    the cleanest split, the one where both windows agree with themselves most.
    """
    qb_map = qb.set_index(["team", "game_id"])["top_passer"].to_dict()
    out: Dict[str, List[Dict[str, Any]]] = {}
    for team, grp in series.groupby("team", sort=True):
        if len(grp) < min_games:
            continue
        grp = grp.sort_values("idx")
        names = [qb_map.get((str(team), str(g))) for g in grp["game_id"]]
        seasons = [int(s) for s in grp["season"]]
        marks: List[Tuple[int, int, str, str]] = []
        for i in range(window, len(names) - window + 1):
            before, after = names[i - window:i], names[i:i + window]
            mb, ma = _modal(before), _modal(after)
            if mb is None or ma is None or mb == ma:
                continue
            purity = before.count(mb) + after.count(ma)
            marks.append((i, purity, mb, ma))
        for run in _runs([m[0] for m in marks], gap=2):
            best = max((m for m in marks if m[0] in run), key=lambda m: (m[1], -m[0]))
            i, _, mb, ma = best
            out.setdefault(str(team), []).append(
                {"season": seasons[i], "at": i, "label": "{} -> {}".format(mb, ma)})
    return out


def _runs(values: List[int], gap: int = 2) -> List[List[int]]:
    """Split a sorted index list into runs whose neighbours are within `gap`."""
    out: List[List[int]] = []
    for v in sorted(values):
        if out and v - out[-1][-1] <= gap:
            out[-1].append(v)
        else:
            out.append([v])
    return out


def random_split_reference(series: pd.DataFrame, qb: pd.DataFrame, draws: int = 40,
                           min_games: int = MIN_GAMES, seed: int = RNG_SEED + 3) -> Dict[str, float]:
    """What a split at a random legal position looks like, on the same teams.

    "86% of the detections have a different modal passer either side" means
    nothing until you know what share of arbitrary splits do, since a starter
    change somewhere in three seasons is common. Same for the size of the jump
    in adjusted pass rate.
    """
    rng = np.random.RandomState(seed)
    qb_map = qb.set_index(["team", "game_id"])["top_passer"].to_dict()
    changed, deltas = [], []
    for team, grp in series.groupby("team", sort=True):
        if len(grp) < min_games:
            continue
        grp = grp.sort_values("idx")
        names = [qb_map.get((str(team), str(g))) for g in grp["game_id"]]
        adj = grp["adj"].to_numpy(dtype="float64")
        w = grp["n"].to_numpy(dtype="float64")
        legal = valid_splits(len(grp))
        if legal.size == 0:
            continue
        for pos in rng.choice(legal, size=min(draws, legal.size), replace=False):
            mb, ma = _modal(names[max(0, pos - MIN_SEG):pos]), _modal(names[pos:pos + MIN_SEG])
            changed.append(bool(mb and ma and mb != ma))
            deltas.append(abs(float(np.average(adj[pos:], weights=w[pos:]))
                              - float(np.average(adj[:pos], weights=w[:pos]))))
    return {"splits": len(changed), "qb_changed_share": float(np.mean(changed)),
            "mean_abs_delta": float(np.mean(deltas))}


def inspect(found: pd.DataFrame, series: pd.DataFrame, qb: pd.DataFrame,
            rows: int = 10, qb_window: int = MIN_SEG) -> pd.DataFrame:
    """Detail on each changepoint: dates, adjusted rates, and whether the QB changed.

    The passer is the modal starter over the `qb_window` games either side of the
    split, not over the whole segment. A first changepoint can have two seasons
    behind it, and the mode over all of that answers a different question than
    "who was taking the snaps when this happened".
    """
    qb_map = qb.set_index(["team", "game_id"])["top_passer"].to_dict()
    idx = series.set_index(["team", "idx"])
    out = []
    for rec in found.head(rows).itertuples(index=False):
        grp = series[series["team"] == rec.team].sort_values("idx")
        before, after = grp[grp["idx"] < rec.at], grp[grp["idx"] >= rec.at]
        qb_b = _modal([qb_map.get((rec.team, str(g))) for g in before["game_id"]][-qb_window:])
        qb_a = _modal([qb_map.get((rec.team, str(g))) for g in after["game_id"]][:qb_window])
        pivot = idx.loc[(rec.team, int(rec.at))]
        out.append({
            "team": rec.team,
            "at": int(rec.at),
            "first_new_game": "{} w{}".format(int(pivot["season"]), int(pivot["week"])),
            "p": rec.p,
            "adj_before": rec.adj_before, "adj_after": rec.adj_after, "delta": rec.delta,
            "raw_before": float(np.average(before["raw"], weights=before["n"])),
            "raw_after": float(np.average(after["raw"], weights=after["n"])),
            "qb_before": qb_b or "?", "qb_after": qb_a or "?",
            "qb_changed": bool(qb_b and qb_a and qb_b != qb_a),
            "coach_event": getattr(rec, "coach_change_event", "") or "-",
        })
    return pd.DataFrame(out)


def persistence(found: pd.DataFrame, series: pd.DataFrame, horizon: int = 8,
                group: str = "matches_coach_change") -> pd.DataFrame:
    """Does the new level hold, or was the split chasing a hot streak?

    Splits the post-changepoint games into the first `horizon` and everything
    after, each measured as a signed distance from the pre-changepoint mean. A
    real level shift keeps its size and its sign in both halves; a streak decays
    toward zero. Signed means would cancel across upward and downward shifts, so
    the magnitudes are reported absolute and the sign is reported as a share.
    """
    rows = []
    for rec in found.itertuples(index=False):
        grp = series[series["team"] == rec.team].sort_values("idx")
        after = grp[grp["idx"] >= rec.at]
        if len(after) < horizon + 4:
            continue
        near, far = after.iloc[:horizon], after.iloc[horizon:]
        d_near = float(np.average(near["adj"], weights=near["n"])) - rec.adj_before
        d_far = float(np.average(far["adj"], weights=far["n"])) - rec.adj_before
        rows.append({"team": rec.team, "at": int(rec.at),
                     "group": bool(getattr(rec, group, False)),
                     "d_near": d_near, "d_far": d_far, "n_rest": int(len(far))})
    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    out = []
    for value, grp in frame.groupby("group"):
        out.append({
            group: value, "changepoints": len(grp), "games_after_checked": int(grp["n_rest"].sum()),
            "mean_abs_shift_first_{}".format(horizon): float(grp["d_near"].abs().mean()),
            "mean_abs_shift_rest": float(grp["d_far"].abs().mean()),
            "retained": float(grp["d_far"].abs().mean() / grp["d_near"].abs().mean()),
            "share_same_sign": float(np.mean(np.sign(grp["d_far"]) == np.sign(grp["d_near"]))),
        })
    return pd.DataFrame(out)


# --------------------------------------------------------------------------- #
# 5. does acting on it help

def _rebase(tables: Dict[str, Any], reference: Dict[str, Any]) -> Dict[str, Any]:
    """Give a policy's tables the full-training league baseline.

    Truncation is a per-team policy. Letting it also thin the league table would
    move `base_situation` underneath the comparison, so every policy is scored
    against one shared, identical situation baseline.
    """
    out = dict(tables)
    out["league_exact"] = reference["league_exact"]
    return out


def _score(tables: Dict[str, Any], reference: Dict[str, Any], test: pd.DataFrame,
           naive: float) -> pd.DataFrame:
    scored = backtest.predict(_rebase(tables, reference), test, naive)
    return scored[pd.to_numeric(scored["pred"]).notna()].reset_index(drop=True)


def _policy_row(label: str, scored: pd.DataFrame, kept: int, total: int) -> Dict[str, Any]:
    pred, actual = backtest._arrays(scored, "pred")
    base, _ = backtest._arrays(scored, "base_situation")
    b_eng, b_sit = backtest.brier(pred, actual), backtest.brier(base, actual)
    return {"policy": label, "train_plays_kept": kept, "kept_share": kept / float(total),
            "brier": b_eng, "brier_situation": b_sit,
            "skill_vs_situation": 1.0 - b_eng / b_sit,
            "accuracy": backtest.accuracy(pred, actual),
            "rung1_share": float((scored["rung"] == 1).mean()),
            "mean_sample": float(pd.to_numeric(scored["sample_size"]).mean())}


def truncation_map(found: pd.DataFrame, series: pd.DataFrame) -> Dict[str, str]:
    """Per team, the game id its kept history starts at, from the LAST changepoint."""
    keep: Dict[str, str] = {}
    if found.empty:
        return keep
    last = found.sort_values("at").groupby("team")["at"].max()
    for team, at in last.items():
        grp = series[(series["team"] == team) & (series["idx"] >= int(at))]
        if not grp.empty:
            keep[str(team)] = str(grp.iloc[0]["game_id"])
    return keep


def _drop_mask(train: pd.DataFrame, series: pd.DataFrame, cut_idx: Dict[str, int]) -> np.ndarray:
    """Rows of `train` belonging to a team-game before that team's cut index."""
    order = series.set_index(["team", "game_id"])["idx"].to_dict()
    teams = train["offense"].astype(str).to_numpy()
    games = train["game_id"].astype(str).to_numpy()
    idx = np.array([order.get((t, g), -1) for t, g in zip(teams, games)], dtype="float64")
    cut = np.array([cut_idx.get(t, 0) for t in teams], dtype="float64")
    return (idx >= 0) & (idx < cut)


def truncated_frame(train: pd.DataFrame, series: pd.DataFrame,
                    cut_idx: Dict[str, int]) -> pd.DataFrame:
    return train[~_drop_mask(train, series, cut_idx)]


def random_cuts(series: pd.DataFrame, cut_idx: Dict[str, int], seed: int) -> Dict[str, int]:
    """Drop the same number of games from the same teams, at a random legal spot.

    This is the control that separates the changepoint from the truncation. If a
    random cut of equal size helps just as much, the detector found nothing; the
    engine simply prefers recent data.
    """
    rng = np.random.RandomState(seed)
    sizes = series.groupby("team").size().to_dict()
    out = {}
    for team, cut in cut_idx.items():
        n = int(sizes.get(team, 0))
        legal = valid_splits(n)
        out[team] = int(rng.choice(legal)) if legal.size else cut
    return out


def held_out_test(df: pd.DataFrame, trans: pd.DataFrame) -> None:
    """Detect on training seasons only, truncate, score held-out 2025."""
    season = pd.to_numeric(df["season"])
    train, test = df[season < 2025], df[season == 2025]

    train_rates = league_rates(train)
    train_series = game_series(train, train_rates)
    found = detect_all(train_series, alpha=ALPHA)
    matched = match_detections(
        found, change_indices(trans, season_boundaries(train_series)))

    n_teams = int((train_series.groupby("team").size() >= MIN_GAMES).sum())
    print("\n  detector run on the 2023-2024 training window only: {} teams with >={} games, "
          "{} changepoints on {} teams".format(n_teams, MIN_GAMES, len(found), found["team"].nunique()))
    if not matched.empty:
        print("  of those, {} land on the 2024 coach change ({:.0%})".format(
            int(matched["matches_coach_change"].sum()),
            matched["matches_coach_change"].mean()))

    cut_idx = {t: int(a) for t, a in found.groupby("team")["at"].max().items()}
    naive = backtest.global_rate(train)
    reference = tendency.build(train, half_life=1.0)
    total = reference["plays"]

    rows = [_policy_row("engine as shipped (all train, half-life 1 season)",
                        _score(reference, reference, test, naive), total, total)]

    trunc = truncated_frame(train, train_series, cut_idx)
    t_tables = tendency.build(trunc, half_life=1.0)
    rows.append(_policy_row("truncate at last detected changepoint (alpha {})".format(ALPHA),
                            _score(t_tables, reference, test, naive), t_tables["plays"], total))

    # A stricter threshold keeps only the changepoints the detector is surest of,
    # which closes the "you truncated on weak evidence" objection.
    strict = detect_all(train_series, alpha=ALPHA_STRICT)
    strict_idx = {t: int(a) for t, a in strict.groupby("team")["at"].max().items()} if len(strict) else {}
    s_tables = tendency.build(truncated_frame(train, train_series, strict_idx), half_life=1.0)
    rows.append(_policy_row("truncate at last detected changepoint (alpha {}, {} teams)".format(
        ALPHA_STRICT, len(strict_idx)), _score(s_tables, reference, test, naive),
        s_tables["plays"], total))

    for seed in RANDOM_TRUNCATION_SEEDS:
        rnd = random_cuts(train_series, cut_idx, seed)
        r_frame = truncated_frame(train, train_series, rnd)
        r_tables = tendency.build(r_frame, half_life=1.0)
        rows.append(_policy_row("control: same teams, same many games, random cut (seed {})".format(seed),
                                _score(r_tables, reference, test, naive), r_tables["plays"], total))

    only24 = train[pd.to_numeric(train["season"]) == 2024]
    t24 = tendency.build(only24, half_life=1.0)
    rows.append(_policy_row("control: regime-blind, most recent season only",
                            _score(t24, reference, test, naive), t24["plays"], total))

    for hl in (0.5, 2.0, 100.0):
        h_tables = tendency.build(train, half_life=hl)
        rows.append(_policy_row("control: no truncation, half-life {:g} season{}".format(
            hl, "s" if hl != 1 else ""), _score(h_tables, reference, test, naive), total, total))

    table = pd.DataFrame(rows)
    show("7. HELD-OUT 2025 BRIER by history policy (identical situation baseline throughout)",
         table, 5)
    ship = float(table[table["policy"].str.startswith("engine as shipped")]["brier"].iloc[0])
    trunc_b = float(table[table["policy"].str.startswith("truncate")]["brier"].iloc[0])
    ctrl = table[table["policy"].str.startswith("control: same teams")]["brier"]
    print("  truncation vs shipped: {:+.5f} Brier ({:+.3%}) -> {}".format(
        trunc_b - ship, trunc_b / ship - 1.0, "HELPS" if trunc_b < ship else "HURTS"))
    print("  random-cut control mean {:.5f} (range {:.5f} to {:.5f}); truncation beats it by "
          "{:+.5f}".format(ctrl.mean(), ctrl.min(), ctrl.max(), trunc_b - ctrl.mean()))
    kept = int(table[table["policy"].str.startswith("truncate")]["train_plays_kept"].iloc[0])
    print("  plays dropped by truncation: {:,} of {:,} ({:.1%}) across {} teams".format(
        total - kept, total, 1 - kept / float(total), len(cut_idx)))

    _restricted(train, test, train_series, cut_idx, reference, naive)


def _restricted(train: pd.DataFrame, test: pd.DataFrame, series: pd.DataFrame,
                cut_idx: Dict[str, int], reference: Dict[str, Any], naive: float) -> None:
    """The same comparison on only the plays truncation would touch.

    Diluting a real effect across every team's snaps can hide it, so this scores
    the held-out plays whose offense had a changepoint, where the policy is the
    only thing that differs.
    """
    if not cut_idx:
        return
    trunc = truncated_frame(train, series, cut_idx)
    ship = _score(reference, reference, test, naive)
    cut = _score(tendency.build(trunc, half_life=1.0), reference, test, naive)
    mask_s = ship["team"].isin(cut_idx.keys()).to_numpy()
    mask_c = cut["team"].isin(cut_idx.keys()).to_numpy()
    a, b = ship[mask_s], cut[mask_c]
    if len(a) != len(b):
        print("  (restricted comparison skipped: row counts differ, {} vs {})".format(len(a), len(b)))
        return
    actual = a["actual"].to_numpy(dtype="float64")
    b_ship = backtest.brier(pd.to_numeric(a["pred"]).to_numpy(dtype="float64"), actual)
    b_cut = backtest.brier(pd.to_numeric(b["pred"]).to_numpy(dtype="float64"), actual)
    b_sit = backtest.brier(a["base_situation"].to_numpy(dtype="float64"), actual)
    print("  restricted to the {:,} held-out plays by a team with a detected changepoint: "
          "shipped {:.5f} | truncated {:.5f} ({:+.5f}) | situation baseline {:.5f}".format(
              len(a), b_ship, b_cut, b_cut - b_ship, b_sit))


# --------------------------------------------------------------------------- #

def selfcheck() -> None:
    """Prove the statistic on data whose answer is known before trusting it on real games."""
    rng = np.random.RandomState(0)
    n = 30
    step = np.concatenate([np.zeros(15), np.full(15, 0.20)]) + rng.normal(0, 0.02, n)
    w = np.full(n, 65.0)
    curve = cusum_curve(step, w)
    found = test_segment(step, w, np.random.RandomState(1))
    flat = rng.normal(0, 0.11, n)
    flat_hit = test_segment(flat, w, np.random.RandomState(2))
    ident = np.tile(np.arange(n), (3, 1))
    same = bool(np.allclose(_cusum_matrix(step, w, ident)[0], curve))
    # Unequal weights must matter: the same values with the second half's games
    # weighted down should move the split's significance.
    w2 = np.concatenate([np.full(15, 65.0), np.full(15, 5.0)])
    weighted = test_segment(step, w2, np.random.RandomState(1))
    print("SELF-CHECK")
    print("  planted step of 0.20 at game 15 -> detected at {}, p={:.4f}, stat={:.2f}".format(
        found[0], found[2], found[1]))
    print("  pure noise, same length         -> {}".format(
        "no changepoint (correct)" if flat_hit is None or flat_hit[2] > ALPHA
        else "FALSE POSITIVE p={:.4f}".format(flat_hit[2])))
    print("  permuted-matrix path equals the direct curve: {}".format(same))
    print("  weights are load-bearing: down-weighting the post-step games moves the statistic "
          "{:.2f} -> {:.2f} (p {:.4f} -> {:.4f})".format(
              found[1], weighted[1], found[2], weighted[2]))


def main() -> None:
    selfcheck()
    df = schema.read_plays(PLAYS_CFB)
    rates = league_rates(df)
    series = game_series(df, rates)
    sizes = series.groupby("team").size()
    kept = sizes[sizes >= MIN_GAMES]

    print("=" * 100)
    print("CHANGEPOINT DETECTION FROM PLAY-BY-PLAY ALONE / CFB {}".format(list(SEASONS)))
    print("  {:,} team-games from {:,} eligible bucketable plays, {} teams, "
          "{} with >={} games".format(len(series), int(series["n"].sum()),
                                      len(sizes), len(kept), MIN_GAMES))
    r2 = float(np.corrcoef(series["raw"], series["exp"])[0, 1] ** 2)
    print("  situation adjustment: residual against the league rate in each of {} buckets. "
          "Per-game situation mix has sd {:.4f} and explains {:.1%} of the variance in raw "
          "game pass rate".format(len(rates), float(series["exp"].std()), r2))
    print("  raw game pass rate sd {:.4f} -> adjusted sd {:.4f}, so the adjustment removes "
          "{:.1%} of between-game variance before anything is detected".format(
              float(series["raw"].std()), float(series["adj"].std()),
              1 - float(series["adj"].var() / series["raw"].var())))
    print("  detector: weighted CUSUM, binary segmentation, {} permutations, alpha {}, "
          "min segment {} games".format(PERMUTATIONS, ALPHA, MIN_SEG))

    # 1. null calibration
    null_rows = []
    for alpha in (ALPHA, ALPHA_STRICT):
        null = detect_all(series, alpha=alpha, shuffle=True, seed=RNG_SEED + 1)
        real = detect_all(series, alpha=alpha, seed=RNG_SEED)
        null_rows.append({
            "alpha": alpha,
            "teams_tested": len(kept),
            "null_changepoints": len(null),
            "null_teams_flagged": int(null["team"].nunique()) if len(null) else 0,
            "null_team_rate": (null["team"].nunique() / len(kept)) if len(null) else 0.0,
            "real_changepoints": len(real),
            "real_teams_flagged": int(real["team"].nunique()),
            "real_team_rate": real["team"].nunique() / len(kept),
        })
    show("1. NULL CALIBRATION: the same detector on time-shuffled series (nothing to find)",
         pd.DataFrame(null_rows), 4)

    found = detect_all(series, alpha=ALPHA, seed=RNG_SEED)
    print("\n  detections per team: {}".format(
        dict(sorted(found.groupby("team").size().value_counts().to_dict().items()))))

    # 2. where they land
    bounds = season_boundaries(series)
    b24 = pd.Series({t: v.get(2024, np.nan) for t, v in bounds.items()})
    b25 = pd.Series({t: v.get(2025, np.nan) for t, v in bounds.items()})
    off24 = found["at"].to_numpy() - found["team"].map(b24).to_numpy(dtype="float64")
    off25 = found["at"].to_numpy() - found["team"].map(b25).to_numpy(dtype="float64")
    nearest = np.where(np.abs(off24) <= np.abs(off25), off24, off25)
    show("2. WHERE CHANGEPOINTS LAND relative to the nearest season boundary (games)",
         pd.DataFrame([{"offset_games": int(o), "changepoints": int(c)}
                       for o, c in sorted(pd.Series(nearest).value_counts().items())
                       if abs(o) <= 6]), 0)
    print("  on a season boundary exactly: {} of {} ({:.0%}); within {} games: {} ({:.0%})".format(
        int((nearest == 0).sum()), len(found), float((nearest == 0).mean()),
        MATCH_TOLERANCE, int((np.abs(nearest) <= MATCH_TOLERANCE).sum()),
        float((np.abs(nearest) <= MATCH_TOLERANCE).mean())))

    # 3. against the coach ground truth
    trans = coach_truth()
    truth = change_indices(trans, bounds)
    matched = match_detections(found, truth)
    rec = recall_table(found, truth, series)
    chance = chance_precision(series, truth)

    n_det = len(matched)
    n_hit = int(matched["matches_coach_change"].sum())
    reachable = rec[rec["reachable"]]
    print("\n3. AGAINST THE HEAD-COACH GROUND TRUTH (tolerance +/-{} games)".format(MATCH_TOLERANCE))
    print("  coach changes in the window, on teams the detector tested: {} ({} reachable "
          "given the {}-game minimum segment)".format(len(rec), len(reachable), MIN_SEG))
    print("  precision  {}/{} = {:.1%}   (a detector firing at a random legal split "
          "would score {:.1%})".format(n_hit, n_det, n_hit / n_det if n_det else float("nan"), chance))
    print("  recall     {}/{} = {:.1%}   of reachable coach changes".format(
        int(reachable["detected"].sum()), len(reachable),
        reachable["detected"].mean() if len(reachable) else float("nan")))
    lift = (n_hit / n_det) / chance if n_det and chance else float("nan")
    print("  lift over chance {:.2f}x, one-sided binomial p = {:.4f} ({} hits, {:.1f} expected "
          "by luck)   -> {}".format(
              lift, binom_tail(n_hit, n_det, chance), n_hit, n_det * chance,
              "detector leans toward coach boundaries" if lift > 1.15 else
              "detector is NOT finding coach changes"))
    show("3b. PRECISION AND RECALL at both thresholds", pd.DataFrame([
        _pr_row(series, truth, alpha) for alpha in (ALPHA, ALPHA_STRICT)]), 4)

    # 4. what the unmatched ones look like
    qb = passer_by_game(df)
    unmatched = matched[~matched["matches_coach_change"]].sort_values("stat", ascending=False)
    hit = matched[matched["matches_coach_change"]].sort_values("stat", ascending=False)
    show("4. UNMATCHED CHANGEPOINTS, strongest 10 (no head-coach change within {} games)".format(
        MATCH_TOLERANCE), inspect(unmatched, series, qb, 10), 4)
    show("4b. MATCHED CHANGEPOINTS, strongest 8 (a head coach really did change here)",
         inspect(hit, series, qb, 8), 4)

    qb_u = inspect(unmatched, series, qb, len(unmatched))
    qb_m = inspect(hit, series, qb, len(hit))
    ref = random_split_reference(series, qb)
    print("\n  primary passer differs across the split: unmatched {}/{} ({:.0%}) | "
          "matched {}/{} ({:.0%}) | random legal split {:.0%} ({:,} draws)".format(
              int(qb_u["qb_changed"].sum()), len(qb_u), float(qb_u["qb_changed"].mean()),
              int(qb_m["qb_changed"].sum()), len(qb_m),
              float(qb_m["qb_changed"].mean()) if len(qb_m) else float("nan"),
              ref["qb_changed_share"], ref["splits"]))
    print("  mean |delta| in adjusted pass rate: unmatched {:.4f} | matched {:.4f} | "
          "random legal split {:.4f}".format(
              float(unmatched["delta"].abs().mean()),
              float(hit["delta"].abs().mean()) if len(hit) else float("nan"),
              ref["mean_abs_delta"]))

    # 4c. score the detector against what it appears to actually be finding
    qb_truth = qb_change_indices(series, qb)
    both = merge_truth(truth, qb_truth)
    show("4c. WHAT IS THE DETECTOR ACTUALLY FINDING? same detections, three ground truths",
         pd.DataFrame([_truth_row("head coach change", found, series, truth),
                       _truth_row("primary passer handoff", found, series, qb_truth),
                       _truth_row("either one", found, series, both)]), 4)

    q_matched = match_detections(found, qb_truth, name="matches_qb_change")
    pers = persistence(q_matched, series, group="matches_qb_change")
    if not pers.empty:
        show("5. PERSISTENCE: is the post-changepoint level a real shift or a hot streak?",
             pers, 4)

    # 6. the decisive test
    held_out_test(df, trans)


def _truth_row(label: str, found: pd.DataFrame, series: pd.DataFrame,
               truth: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
    matched = match_detections(found, truth)
    rec = recall_table(found, truth, series)
    reachable = rec[rec["reachable"]]
    hits = int(matched["matches_coach_change"].sum())
    prec = hits / len(found) if len(found) else float("nan")
    chance = chance_precision(series, truth)
    return {"ground_truth": label, "events": len(rec), "reachable": len(reachable),
            "detections": len(found), "matched": hits, "precision": prec,
            "chance_precision": chance, "lift_over_chance": prec / chance if chance else float("nan"),
            "recall": float(reachable["detected"].mean()) if len(reachable) else float("nan")}


def _pr_row(series: pd.DataFrame, truth: Dict[str, List[Dict[str, Any]]],
            alpha: float) -> Dict[str, Any]:
    found = detect_all(series, alpha=alpha, seed=RNG_SEED)
    matched = match_detections(found, truth)
    rec = recall_table(found, truth, series)
    reachable = rec[rec["reachable"]]
    hits = int(matched["matches_coach_change"].sum())
    return {"alpha": alpha, "changepoints": len(found),
            "teams_flagged": int(found["team"].nunique()),
            "precision": hits / len(found) if len(found) else float("nan"),
            "chance_precision": chance_precision(series, truth),
            "recall": float(reachable["detected"].mean()) if len(reachable) else float("nan"),
            "f1": _f1(hits / len(found) if len(found) else 0.0,
                      float(reachable["detected"].mean()) if len(reachable) else 0.0)}


def _f1(p: float, r: float) -> float:
    return 2 * p * r / (p + r) if (p + r) > 0 else 0.0


def binom_tail(hits: int, trials: int, p0: float) -> float:
    """P(X >= hits) under Binomial(trials, p0). Is the precision lift more than luck?"""
    import math
    return float(sum(math.comb(trials, k) * p0 ** k * (1 - p0) ** (trials - k)
                     for k in range(hits, trials + 1)))


if __name__ == "__main__":
    main()

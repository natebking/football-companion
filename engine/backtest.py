"""Out-of-sample validation of the tendency tables.

Binding spec: docs/CONTRACT.md, "Tendency query and fallback ladder".

The question this module answers is narrow and falsifiable: when `tendency.query`
says a team passes here 78% of the time, do they pass 78% of the time on plays
the tables have never seen? Nothing here is allowed to touch the held-out data
before scoring. `build()` is handed the training frame only, so the ladder's own
"all seasons" rung (4) also sees training seasons only.

Method
------
1. Split the play frame in time. Multi-season frames hold out the most recent
   season. A single-season frame (the NFL parquet is 2024 only) holds out the
   most recent weeks instead, which is a weaker test and is labelled as such.
2. Build tables on the training side.
3. For every held-out eligible play, query the block and record the predicted
   `pass_rate` against the actual `is_pass`.
4. Score it: calibration, Brier, accuracy by rung and confidence, rung reach.

Predictions are memoised per (team, bucket key). `query()` is a pure function of
down, distance band and field zone, so one lookup per distinct key is exactly
equal to one lookup per play; `_verify_memo` proves that on real rows instead of
asserting it.

Baselines
---------
Both are computed from the training side only.

* `global`   - one number, the training pass rate over every eligible play. The
               literal "naive league average". This is the pass condition.
* `situation`- the league's rate for the exact bucket, which is the `pass_rate`
               the engine already ships as `league_pass_rate`. Situation but no
               team. This is the bar that matters: beating `global` only proves
               that down and distance predict, which nobody doubts. Beating
               `situation` is what proves team attribution earns its place.
"""
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import buckets  # noqa: E402
import schema  # noqa: E402
import tendency  # noqa: E402

# A single-season frame is split by week instead of season. The cut is the
# earliest week whose tail holds at least this share of eligible plays.
HOLDOUT_TAIL_SHARE = 0.25

# One representative situation per bucket key, used to memoise query(). Any
# member of the bucket produces the same block; these are the midpoints.
REP_DISTANCE: Dict[str, int] = {"short": 2, "medium": 6, "long": 10}
REP_YTG: Dict[str, int] = {"own_deep": 90, "own": 70, "mid": 50, "opp": 30, "red": 10}

CALIBRATION_BINS = np.round(np.arange(0.0, 1.01, 0.1), 2)


# --------------------------------------------------------------------------- #
# split

def temporal_split(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame, str]:
    """Train on the past, test on the future. Returns (train, test, label)."""
    seasons = sorted(int(s) for s in df["season"].dropna().unique())
    if len(seasons) > 1:
        cut = seasons[-1]
        label = "season {} held out, trained on {}".format(cut, seasons[:-1])
        return df[df["season"] < cut], df[df["season"] == cut], label

    el = tendency.eligible(df)
    weeks = sorted(int(w) for w in el["week"].dropna().unique())
    tail = el.groupby("week").size().sort_index()[::-1].cumsum() / len(el)
    cut = max(w for w in weeks if tail.get(w, 0.0) >= HOLDOUT_TAIL_SHARE)
    label = ("single season {}, no season holdout possible; weeks {}+ held out "
             "({:.1%} of eligible plays), trained on weeks {}-{}".format(
                 seasons[0], cut, tail[cut], weeks[0], cut - 1))
    return df[df["week"] < cut], df[df["week"] >= cut], label


# --------------------------------------------------------------------------- #
# prediction

def _rep(key: str) -> Tuple[int, int, int]:
    down, band, zone = key.split("_", 2)
    return int(down[1:]), REP_DISTANCE[band], REP_YTG[zone]


def predict(tables: Dict[str, Any], test: pd.DataFrame, naive_rate: float) -> pd.DataFrame:
    """One row per held-out play: prediction, rung, actual, and both baselines.

    `pred_demoted` is the diagnostic variant the tendency author flagged as an
    open question: rung 4 (team, down only) demoted below rung 5 whenever the
    league's exact bucket already clears the sample floor.
    """
    el = tendency.eligible(test).copy()
    el["key"] = buckets.bucket_series(el["down"], el["distance"], el["yards_to_goal"])
    unbucketable = int(el["key"].isna().sum())
    el = el[el["key"].notna()]
    el["team"] = el["offense"].astype(str)

    league_exact = tables["league_exact"]
    floor = tables.get("min_sample", tendency.MIN_SAMPLE)

    memo: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for team, key in el.groupby(["team", "key"]).size().index:
        memo[(team, key)] = tendency.query(tables, team, *_rep(key))

    blocks = [memo[(t, k)] for t, k in zip(el["team"], el["key"])]
    out = pd.DataFrame({
        "team": el["team"].to_numpy(),
        "key": el["key"].to_numpy(),
        "season": pd.to_numeric(el["season"]).to_numpy(),
        "week": pd.to_numeric(el["week"]).to_numpy(),
        "actual": el["is_pass"].astype(bool).to_numpy(),
        "pred": [b["pass_rate"] for b in blocks],
        "rung": [b["rung"] for b in blocks],
        "confidence": [b["confidence"] for b in blocks],
        "sample_size": [b["sample_size"] for b in blocks],
    })

    situation = np.array([_lookup(league_exact, k, "pass_rate") for k in out["key"]], dtype="float64")
    out["base_global"] = naive_rate
    out["base_situation"] = np.where(np.isnan(situation), naive_rate, situation)

    lg_n = np.array([_lookup(league_exact, k, "sample_size") for k in out["key"]], dtype="float64")
    demote = (out["rung"].to_numpy() == 4) & (lg_n >= floor)
    out["pred_demoted"] = np.where(demote, out["base_situation"].to_numpy(),
                                   pd.to_numeric(out["pred"]).to_numpy(dtype="float64"))

    out.attrs["unbucketable"] = unbucketable
    out.attrs["demoted_rows"] = int(demote.sum())
    out.attrs["naive_rate"] = naive_rate
    return out


def _lookup(table: Dict[str, Dict[str, Any]], key: str, field: str) -> float:
    stats = table.get(key)
    if stats is None or stats.get(field) is None:
        return float("nan")
    return float(stats[field])


def global_rate(train: pd.DataFrame) -> float:
    """The naive baseline: one number, the training pass rate over every eligible play."""
    return float(tendency.eligible(train)["is_pass"].astype(bool).mean())


def _verify_memo(tables: Dict[str, Any], test: pd.DataFrame, scored: pd.DataFrame, n: int = 300) -> str:
    """Prove the per-key memo equals a per-play query, on real held-out rows."""
    el = tendency.eligible(test)
    el = el[buckets.bucket_series(el["down"], el["distance"], el["yards_to_goal"]).notna()]
    idx = np.random.RandomState(0).choice(len(el), size=min(n, len(el)), replace=False)
    rows = el.iloc[idx]
    got = scored.iloc[idx]
    bad = 0
    for (_, row), (_, memoed) in zip(rows.iterrows(), got.iterrows()):
        direct = tendency.query(tables, str(row["offense"]), int(row["down"]),
                                int(row["distance"]), int(row["yards_to_goal"]))
        same = (direct["rung"] == memoed["rung"] and direct["pass_rate"] == memoed["pred"]
                and direct["bucket"] == memoed["key"])
        bad += int(not same)
    return "memo vs per-play query on {} random held-out rows: {} mismatches (must be 0)".format(len(rows), bad)


# --------------------------------------------------------------------------- #
# scoring

def brier(pred: np.ndarray, actual: np.ndarray) -> float:
    return float(np.mean((pred - actual) ** 2))


def accuracy(pred: np.ndarray, actual: np.ndarray) -> float:
    return float(np.mean((pred >= 0.5) == actual))


def _arrays(frame: pd.DataFrame, col: str) -> Tuple[np.ndarray, np.ndarray]:
    return (pd.to_numeric(frame[col]).to_numpy(dtype="float64"),
            frame["actual"].to_numpy(dtype="float64"))


def calibration(frame: pd.DataFrame, col: str = "pred") -> Tuple[pd.DataFrame, float]:
    """Fixed 0.1-wide bins across [0, 1]. Returns (table, expected calibration error)."""
    pred, actual = _arrays(frame, col)
    idx = np.clip(np.digitize(pred, CALIBRATION_BINS[1:-1], right=False), 0, 9)
    rows = []
    ece = 0.0
    for b in range(10):
        m = idx == b
        if not m.any():
            continue
        obs, avg = float(actual[m].mean()), float(pred[m].mean())
        rows.append({"bin": "{:.1f}-{:.1f}".format(CALIBRATION_BINS[b], CALIBRATION_BINS[b + 1]),
                     "n": int(m.sum()), "share": m.mean(), "predicted": avg,
                     "observed": obs, "gap": obs - avg})
        ece += m.mean() * abs(obs - avg)
    return pd.DataFrame(rows), ece


def calibration_deciles(frame: pd.DataFrame, col: str = "pred") -> pd.DataFrame:
    """Equal-count deciles of the prediction distribution, for where fixed bins go thin."""
    pred, actual = _arrays(frame, col)
    ranks = pd.Series(pred).rank(method="first")
    bins = pd.qcut(ranks, 10, labels=False)
    rows = []
    for b in sorted(pd.unique(bins)):
        m = (bins == b).to_numpy()
        rows.append({"decile": int(b) + 1, "n": int(m.sum()),
                     "pred_lo": float(pred[m].min()), "pred_hi": float(pred[m].max()),
                     "predicted": float(pred[m].mean()), "observed": float(actual[m].mean()),
                     "gap": float(actual[m].mean() - pred[m].mean())})
    return pd.DataFrame(rows)


def breakdown(frame: pd.DataFrame, by: str) -> pd.DataFrame:
    """Per-group n, reach share, engine Brier and accuracy, and the same for both baselines."""
    total = len(frame)
    rows = []
    for value, grp in frame.groupby(by, sort=True):
        pred, actual = _arrays(grp, "pred")
        base_g, _ = _arrays(grp, "base_global")
        base_s, _ = _arrays(grp, "base_situation")
        rows.append({
            by: value, "n": len(grp), "reach": len(grp) / total,
            "predicted": float(pred.mean()), "observed": float(actual.mean()),
            "accuracy": accuracy(pred, actual), "brier": brier(pred, actual),
            "brier_situation": brier(base_s, actual), "brier_global": brier(base_g, actual),
            "acc_situation": accuracy(base_s, actual),
        })
    out = pd.DataFrame(rows)
    out["skill_vs_situation"] = 1.0 - out["brier"] / out["brier_situation"]
    return out


SHRINK_GRID = np.round(np.arange(0.0, 1.01, 0.1), 2)
SHRINK_FINE = np.round(np.arange(0.0, 1.001, 0.01), 2)


def _blend(frame: pd.DataFrame, weight: float) -> np.ndarray:
    pred, _ = _arrays(frame, "pred")
    base, _ = _arrays(frame, "base_situation")
    return weight * pred + (1.0 - weight) * base


def shrinkage(frame: pd.DataFrame) -> pd.DataFrame:
    """How much of the team-specific number survives out of sample.

    Blends the engine's answer toward the league's rate for the same situation.
    weight 1.0 is the engine as shipped, 0.0 is the situation baseline. The
    minimising weight is the share of the team signal that is real rather than
    noise the tables memorised.
    """
    actual = frame["actual"].to_numpy(dtype="float64")
    return pd.DataFrame([{"team_weight": w, "brier": brier(_blend(frame, w), actual),
                          "accuracy": accuracy(_blend(frame, w), actual)}
                         for w in SHRINK_GRID])


def best_weight(frame: pd.DataFrame) -> Tuple[float, float]:
    actual = frame["actual"].to_numpy(dtype="float64")
    scores = [(brier(_blend(frame, w), actual), w) for w in SHRINK_FINE]
    score, weight = min(scores)
    return weight, score


EB_GRID = [0, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 1000]


def eb_blend(frame: pd.DataFrame, k: float) -> np.ndarray:
    """Empirical-Bayes shrink: weight the team rate by n/(n+k), the rest to the situation.

    The per-sample-size table shows the best fixed weight climbing with n, which
    is this curve's shape. `k` is the number of plays at which the team rate and
    the league situation rate deserve equal say.
    """
    pred, _ = _arrays(frame, "pred")
    base, _ = _arrays(frame, "base_situation")
    n = pd.to_numeric(frame["sample_size"]).to_numpy(dtype="float64")
    w = n / (n + k) if k > 0 else np.ones_like(n)
    return w * pred + (1.0 - w) * base


def best_k(frame: pd.DataFrame) -> Tuple[float, float]:
    actual = frame["actual"].to_numpy(dtype="float64")
    score, k = min((brier(eb_blend(frame, k), actual), k) for k in EB_GRID)
    return k, score


SAMPLE_BINS: List[Tuple[str, int, int]] = [
    ("30-49", 30, 49), ("50-74", 50, 74), ("75-124", 75, 124),
    ("125-249", 125, 249), ("250-499", 250, 499), ("500+", 500, 10 ** 9)]


def by_sample_size(frame: pd.DataFrame) -> pd.DataFrame:
    """Does the team number get better as the sample behind it grows?

    Restricted to rung 1, so the filter is held constant (team, exact bucket)
    and the only thing varying is how many plays are behind the rate. Pooling
    every rung here would confound sample size with rung, because the widest
    rungs carry both the largest samples and the worst predictions.

    If skill against the situation baseline climbs with sample size, the team
    signal is real and the contract's floor of 30 is simply too low. If it stays
    flat and negative, there is no team signal to find at this granularity.
    """
    team_rows = frame[frame["rung"] == 1]
    n = pd.to_numeric(team_rows["sample_size"]).to_numpy()
    rows = []
    for label, lo, hi in SAMPLE_BINS:
        grp = team_rows[(n >= lo) & (n <= hi)]
        if grp.empty:
            continue
        pred, actual = _arrays(grp, "pred")
        base, _ = _arrays(grp, "base_situation")
        b_engine, b_base = brier(pred, actual), brier(base, actual)
        weight, _ = best_weight(grp)
        rows.append({"sample_size": label, "n_plays": len(grp),
                     "brier": b_engine, "brier_situation": b_base,
                     "skill_vs_situation": 1.0 - b_engine / b_base,
                     "best_team_weight": weight})
    return pd.DataFrame(rows)


def shrinkage_by_rung(frame: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for rung, grp in frame.groupby("rung", sort=True):
        weight, score = best_weight(grp)
        rows.append({"rung": rung, "n": len(grp), "best_team_weight": weight,
                     "brier_at_best": score, "brier_as_shipped": brier(*_arrays(grp, "pred")),
                     "brier_situation": brier(*_arrays(grp, "base_situation"))})
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #
# printing

def _fmt(value: Any, name: str) -> str:
    if isinstance(value, float):
        if name in ("share", "reach"):
            return "{:.1%}".format(value)
        return "{:+.4f}".format(value) if name in ("gap", "skill_vs_situation") else "{:.4f}".format(value)
    if isinstance(value, (int, np.integer)):
        return "{:,}".format(value)
    return str(value)


def show(title: str, frame: pd.DataFrame) -> None:
    print("\n" + title)
    if frame.empty:
        print("  (empty)")
        return
    cells = [[_fmt(v, c) for c, v in zip(frame.columns, row)] for row in frame.itertuples(index=False)]
    widths = [max(len(str(c)), max(len(r[i]) for r in cells)) for i, c in enumerate(frame.columns)]
    print("  " + "  ".join(str(c).rjust(w) for c, w in zip(frame.columns, widths)))
    for row in cells:
        print("  " + "  ".join(v.rjust(w) for v, w in zip(row, widths)))


# --------------------------------------------------------------------------- #
# run

def run(path: Path, half_life: float = 1.0) -> Dict[str, Any]:
    df = schema.read_plays(path)
    train, test, label = temporal_split(df)
    tables = tendency.build(train, half_life=half_life)
    scored = predict(tables, test, global_rate(train))

    league = tables["league"]
    print("=" * 96)
    print("BACKTEST / {}   file={}".format(league.upper(), path.name))
    print("  split: {}".format(label))
    print("  train: {:,} rows, {:,} eligible, {} teams, seasons {}".format(
        len(train), tables["plays"], len(tables["teams"]), tables["all_seasons"]))
    print("  test:  {:,} rows, {:,} eligible and bucketable, {} teams".format(
        len(test), len(scored), scored["team"].nunique()))

    missing = int(pd.to_numeric(scored["pred"]).isna().sum())
    unseen = sorted(set(scored["team"].unique()) - set(tables["teams"]))
    print("  held-out plays with no prediction at all (dropped from scoring): {}".format(missing))
    print("  held-out teams absent from the training tables: {} {}".format(
        len(unseen), unseen[:6] if unseen else ""))
    print("  held-out rows the contract cannot bucket: {}".format(scored.attrs["unbucketable"]))
    print("  " + _verify_memo(tables, test, scored))
    scored = scored[pd.to_numeric(scored["pred"]).notna()].reset_index(drop=True)

    pred, actual = _arrays(scored, "pred")
    base_g, _ = _arrays(scored, "base_global")
    base_s, _ = _arrays(scored, "base_situation")
    demoted, _ = _arrays(scored, "pred_demoted")

    cal, ece = calibration(scored)
    show("1. CALIBRATION, fixed 0.1 bins (predicted vs observed pass rate)", cal)
    print("  expected calibration error: {:.4f}   (weighted mean |observed - predicted|)".format(ece))
    show("1b. CALIBRATION, equal-count deciles of the prediction distribution",
         calibration_deciles(scored))

    b_engine, b_global, b_situation = brier(pred, actual), brier(base_g, actual), brier(base_s, actual)
    b_demoted = brier(demoted, actual)
    print("\n2. BRIER SCORE (lower is better, {:,} scored plays)".format(len(scored)))
    print("  engine (full ladder)                {:.5f}".format(b_engine))
    print("  baseline: league average only       {:.5f}   ({:.4f} for every play)".format(
        b_global, scored.attrs["naive_rate"]))
    print("  baseline: league rate for situation {:.5f}   (no team attribution)".format(b_situation))
    print("  variant:  rung 4 demoted below 5    {:.5f}   ({:,} rows changed)".format(
        b_demoted, scored.attrs["demoted_rows"]))
    print("  skill vs league average   {:+.2%}   {}".format(
        1 - b_engine / b_global, "PASS" if b_engine < b_global else "FAIL"))
    print("  skill vs situation rate   {:+.2%}   {}".format(
        1 - b_engine / b_situation, "PASS" if b_engine < b_situation else "FAIL"))
    print("  engine accuracy {:.4f}   situation baseline {:.4f}   league average {:.4f}".format(
        accuracy(pred, actual), accuracy(base_s, actual), accuracy(base_g, actual)))

    show("3a. BY RUNG", breakdown(scored, "rung"))
    show("3b. BY CONFIDENCE", breakdown(scored, "confidence"))

    reach = (scored.groupby("rung").size() / len(scored)).rename("reach").reset_index()
    reach["n"] = scored.groupby("rung").size().to_numpy()
    reach["confidence"] = [tendency.RUNG_CONFIDENCE[r] for r in reach["rung"]]
    show("4. RUNG REACH on held-out plays", reach[["rung", "confidence", "n", "reach"]])

    show("5. DIAGNOSTIC: blend the team number toward the league's rate for the same situation",
         shrinkage(scored))
    weight, score = best_weight(scored)
    print("  best team weight {:.2f}, Brier {:.5f}   (1.00 = engine as shipped, 0.00 = situation baseline)".format(
        weight, score))
    show("5b. best blend weight per rung", shrinkage_by_rung(scored))
    show("6. DIAGNOSTIC: rung-1 skill against the situation baseline, by sample behind the number",
         by_sample_size(scored))

    k, k_score = best_k(scored)
    print("  best empirical-Bayes k {:g}, Brier {:.5f}   (team rate weighted n/(n+k))".format(k, k_score))

    return {"league": league, "brier": b_engine, "brier_global": b_global,
            "brier_situation": b_situation, "brier_demoted": b_demoted, "ece": ece,
            "best_weight": weight, "brier_blended": score, "best_k": k, "brier_eb": k_score,
            "n": len(scored), "label": label, "scored": scored}


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    results = []
    for name in ("plays_cfb.parquet", "plays_nfl.parquet"):
        path = root / "data" / name
        if not path.exists():
            print("skip {}, not on disk".format(path))
            continue
        results.append(run(path))
    print("\n" + "=" * 96)
    print("VERDICT")
    for r in results:
        print("  {}: engine {:.5f} vs league-average {:.5f} ({:+.2%}) -> {}".format(
            r["league"], r["brier"], r["brier_global"], 1 - r["brier"] / r["brier_global"],
            "beats baseline" if r["brier"] < r["brier_global"] else "DOES NOT BEAT BASELINE"))
        print("  {}: engine {:.5f} vs situation-rate {:.5f} ({:+.2%}) -> {}".format(
            r["league"], r["brier"], r["brier_situation"], 1 - r["brier"] / r["brier_situation"],
            "beats baseline" if r["brier"] < r["brier_situation"] else "DOES NOT BEAT BASELINE"))

    if len(results) == 2:
        print("\nCROSS-LEAGUE CHECK on the proposed fix (shrink parameter fitted on one league,")
        print("scored on the other, so the improvement is never fitted on the data it is scored on)")
        for fit, apply_to in ((results[0], results[1]), (results[1], results[0])):
            frame = apply_to["scored"]
            actual = frame["actual"].to_numpy(dtype="float64")
            fixed = brier(_blend(frame, fit["best_weight"]), actual)
            eb = brier(eb_blend(frame, fit["best_k"]), actual)
            print("  fit on {} -> scored on {}: shipped {:.5f} | situation {:.5f} | "
                  "fixed w={:.2f} {:.5f} ({:+.2%}) | n/(n+{:g}) {:.5f} ({:+.2%})".format(
                      fit["league"], apply_to["league"], apply_to["brier"], apply_to["brier_situation"],
                      fit["best_weight"], fixed, 1 - fixed / apply_to["brier_situation"],
                      fit["best_k"], eb, 1 - eb / apply_to["brier_situation"]))

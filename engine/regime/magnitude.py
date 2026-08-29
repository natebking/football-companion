"""Is the coaching-regime problem real, and how big is it?

The design doc claims tendency data must be keyed on the offensive coordinator
because a coaching change makes prior seasons "actively wrong". Coordinator
identity has no clean source. Head coach does: CFBD `/coaches` returns head
coaches only, with a hire date. A head-coach change is the strongest available
proxy for a scheme change, and it strictly under-counts (coordinators churn
without the head coach moving), so anything measured here is an upper bound on
what a head-coach-keyed regime table could recover, and a lower bound on total
regime churn.

Nothing here reimplements the engine. Eligibility, bucketing and the ladder all
come from `engine.tendency`, `engine.buckets` and `engine.backtest`.

Measurements
------------
1. Which FBS teams changed head coach between 2023/24 and 2024/25.
2. Per team, per season, per situation bucket: pass rate. Then the season-over-
   season shift, as a sample-weighted mean total-variation distance across the
   buckets the two seasons share. For a two-outcome distribution (pass, run) the
   TV distance is exactly |p1 - p2|, so the metric is a weighted mean absolute
   change in pass rate, weighted by min(n_prev, n_cur) since that is the sample
   actually supporting the comparison.
3. Coach-change shift vs no-change shift, with a third reference: the shift a
   team would show under *no true change at all*, simulated by drawing both
   seasons from their pooled per-bucket rate at the observed sample sizes. That
   is the pure sampling-noise floor. The no-change group sits above it by
   whatever real drift a stable staff has, and the coach-change group has to
   clear the no-change group by enough to matter before regime keying can pay.
4. Offseason turnover rate, and the share of held-out snaps it touches.
5. The decisive predictive test. Train on 2023-2024, score 2025, split the
   held-out plays by whether that team changed head coach for 2025. If the
   team's own (now stale) tendency is worth less for changed teams, the best
   blend weight toward the league situation rate drops for that group. If the
   two groups blend the same, regime keying has nothing to key on.

Run: .venv/bin/python engine/regime/magnitude.py
"""
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import requests

ENGINE = Path(__file__).resolve().parents[1]
ROOT = ENGINE.parent
sys.path.insert(0, str(ENGINE))

import backtest  # noqa: E402
import buckets  # noqa: E402
import ingest_cfb  # noqa: E402
import schema  # noqa: E402
import tendency  # noqa: E402

COACHES_URL = "https://api.collegefootballdata.com/coaches"
RAW_DIR = ROOT / "data" / "raw"
PLAYS_CFB = ROOT / "data" / "plays_cfb.parquet"
SEASONS = (2023, 2024, 2025)

# A bucket enters a season-over-season comparison only if both seasons have at
# least this many plays in it. Sensitivity to this floor is reported.
MIN_BUCKET_N = 10
SENSITIVITY_FLOORS = (5, 10, 20, 30)
# A team-season pair enters the comparison only if the surviving buckets carry
# at least this much total weight, so a team with three usable buckets does not
# get the same vote as a team with thirty.
MIN_PAIR_WEIGHT = 100
NULL_DRAWS = 200
RNG_SEED = 17


# --------------------------------------------------------------------------- #
# 1. head coaches

def fetch_coaches(year: int, api_key: str) -> List[Dict[str, Any]]:
    """Cached GET of /coaches?year=YYYY. One API call per year, ever."""
    path = RAW_DIR / "coaches_{}.json".format(year)
    if path.exists():
        return json.loads(path.read_text())
    headers = {"Authorization": "Bearer " + api_key, "Accept": "application/json"}
    resp = requests.get(COACHES_URL, params={"year": year}, headers=headers, timeout=60)
    if resp.status_code != 200:
        raise RuntimeError("/coaches {} returned {}".format(year, resp.status_code))
    data = resp.json()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    time.sleep(0.5)
    return data


def coach_rows(payload: List[Dict[str, Any]], year: int) -> pd.DataFrame:
    """One row per (coach, school) that coached that school in `year`."""
    rows = []
    for rec in payload:
        for seas in rec.get("seasons", []):
            if int(seas.get("year", -1)) != year:
                continue
            rows.append({
                "year": year,
                "school": seas.get("school"),
                "conference": seas.get("conference"),
                "coach_id": rec.get("id"),
                "coach": "{} {}".format(rec.get("firstName") or "", rec.get("lastName") or "").strip(),
                "hire_date": (rec.get("hireDate") or "")[:10],
                "games": int(seas.get("games") or 0),
            })
    return pd.DataFrame(rows)


def primary_coaches(frames: Dict[int, pd.DataFrame]) -> pd.DataFrame:
    """The coach who ran the most games for a school in a year, plus a mid-season flag."""
    out = []
    for year, frame in sorted(frames.items()):
        for school, grp in frame.groupby("school"):
            grp = grp.sort_values(["games", "hire_date"], ascending=[False, True])
            top = grp.iloc[0]
            out.append({
                "year": year, "school": school, "conference": top["conference"],
                "coach_id": int(top["coach_id"]), "coach": top["coach"],
                "hire_date": top["hire_date"], "games": int(top["games"]),
                "coaches_listed": int(len(grp)),
                "in_season_change": bool((grp["games"] > 0).sum() > 1),
            })
    return pd.DataFrame(out)


def transitions(primary: pd.DataFrame) -> pd.DataFrame:
    """One row per (school, season pair) with whether the head coach changed."""
    rows = []
    years = sorted(primary["year"].unique())
    by_year = {y: primary[primary["year"] == y].set_index("school") for y in years}
    for prev, cur in zip(years[:-1], years[1:]):
        a, b = by_year[prev], by_year[cur]
        for school in sorted(set(a.index) & set(b.index)):
            ra, rb = a.loc[school], b.loc[school]
            changed = bool(int(ra["coach_id"]) != int(rb["coach_id"]))
            # A coach hired after the season opened took over mid-year: the
            # holdout season is then a mix of two regimes, not a clean one, so
            # it gets its own category rather than polluting either side.
            offseason = changed and str(rb["hire_date"]) < "{}-08-01".format(cur)
            rows.append({
                "school": school, "prev_season": prev, "season": cur,
                "conference": rb["conference"],
                "prev_coach": ra["coach"], "coach": rb["coach"],
                "changed": changed,
                "change_kind": "offseason" if offseason else ("in_season" if changed else "none"),
                "hire_date": rb["hire_date"],
                "in_season_change": bool(ra["in_season_change"] or rb["in_season_change"]),
            })
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #
# 2. per team, per season, per bucket

def bucket_counts(df: pd.DataFrame) -> pd.DataFrame:
    """team x season x bucket -> (n, n_pass). Engine eligibility and bucketing."""
    el = tendency.eligible(df).copy()
    key = buckets.bucket_series(el["down"], el["distance"], el["yards_to_goal"])
    el = el[key.notna()]
    out = pd.DataFrame({
        "team": el["offense"].astype(str).to_numpy(),
        "season": pd.to_numeric(el["season"]).astype(int).to_numpy(),
        "bucket": key[key.notna()].to_numpy(),
        "n": 1,
        "n_pass": el["is_pass"].astype(bool).astype(int).to_numpy(),
    })
    return out.groupby(["team", "season", "bucket"], as_index=False).sum()


def _pair_frame(counts: pd.DataFrame, team: str, prev: int, cur: int,
                min_n: int) -> Optional[pd.DataFrame]:
    a = counts[(counts["team"] == team) & (counts["season"] == prev)]
    b = counts[(counts["team"] == team) & (counts["season"] == cur)]
    if a.empty or b.empty:
        return None
    m = a.merge(b, on="bucket", suffixes=("_a", "_b"))
    m = m[(m["n_a"] >= min_n) & (m["n_b"] >= min_n)]
    return None if m.empty else m


def shift(m: pd.DataFrame) -> Tuple[float, float, int]:
    """Sample-weighted mean TV distance across shared buckets.

    Returns (shift, total weight, buckets used). Weight is min(n_a, n_b): the
    comparison in a bucket is only as strong as its thinner season.
    """
    pa = m["n_pass_a"].to_numpy(dtype="float64") / m["n_a"].to_numpy(dtype="float64")
    pb = m["n_pass_b"].to_numpy(dtype="float64") / m["n_b"].to_numpy(dtype="float64")
    w = np.minimum(m["n_a"].to_numpy(dtype="float64"), m["n_b"].to_numpy(dtype="float64"))
    return float(np.sum(w * np.abs(pa - pb)) / np.sum(w)), float(np.sum(w)), int(len(m))


def null_shift(m: pd.DataFrame, rng: np.random.RandomState, draws: int = NULL_DRAWS) -> float:
    """The same shift when nothing actually changed.

    Both seasons are redrawn from the pooled per-bucket pass rate at the observed
    sample sizes, so every bit of the result is sampling noise. This is the floor
    any real signal has to clear.
    """
    na = m["n_a"].to_numpy(dtype="float64")
    nb = m["n_b"].to_numpy(dtype="float64")
    pooled = ((m["n_pass_a"].to_numpy(dtype="float64") + m["n_pass_b"].to_numpy(dtype="float64"))
              / (na + nb))
    w = np.minimum(na, nb)
    sa = rng.binomial(na.astype(int), pooled, size=(draws, len(m))) / na
    sb = rng.binomial(nb.astype(int), pooled, size=(draws, len(m))) / nb
    return float(np.mean(np.sum(w * np.abs(sa - sb), axis=1) / np.sum(w)))


def shift_table(counts: pd.DataFrame, trans: pd.DataFrame, min_n: int = MIN_BUCKET_N,
                min_weight: int = MIN_PAIR_WEIGHT, with_null: bool = True) -> pd.DataFrame:
    """One row per (team, season pair) that has enough shared data to compare."""
    rng = np.random.RandomState(RNG_SEED)
    rows = []
    for rec in trans.itertuples(index=False):
        m = _pair_frame(counts, rec.school, rec.prev_season, rec.season, min_n)
        if m is None:
            continue
        value, weight, used = shift(m)
        if weight < min_weight:
            continue
        rows.append({
            "school": rec.school, "prev_season": rec.prev_season, "season": rec.season,
            "changed": rec.changed, "change_kind": rec.change_kind, "conference": rec.conference,
            "buckets": used, "weight": weight, "shift": value,
            "null_shift": null_shift(m, rng) if with_null else np.nan,
            "prev_coach": rec.prev_coach, "coach": rec.coach,
        })
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #
# 3. comparison

def quartiles(x: np.ndarray) -> Dict[str, float]:
    return {"n": int(len(x)), "min": float(np.min(x)), "q1": float(np.percentile(x, 25)),
            "median": float(np.median(x)), "mean": float(np.mean(x)),
            "q3": float(np.percentile(x, 75)), "p90": float(np.percentile(x, 90)),
            "max": float(np.max(x)), "sd": float(np.std(x, ddof=1))}


def cliffs_delta(a: np.ndarray, b: np.ndarray) -> float:
    """P(a > b) - P(a < b). 0 = identical, +1 = every a above every b."""
    diff = np.sign(a.reshape(-1, 1) - b.reshape(1, -1))
    return float(diff.mean())


def mann_whitney(a: np.ndarray, b: np.ndarray) -> Tuple[float, float]:
    """U statistic and a two-sided normal-approximation p value, ties corrected."""
    na, nb = len(a), len(b)
    ranks = pd.Series(np.concatenate([a, b])).rank().to_numpy()
    ua = ranks[:na].sum() - na * (na + 1) / 2.0
    mu = na * nb / 2.0
    _, tie_counts = np.unique(np.concatenate([a, b]), return_counts=True)
    n = na + nb
    tie_term = float(np.sum(tie_counts ** 3 - tie_counts))
    sd = np.sqrt(na * nb / 12.0 * ((n + 1) - tie_term / (n * (n - 1.0))))
    z = (ua - mu) / sd if sd > 0 else 0.0
    p = 2.0 * (1.0 - _norm_cdf(abs(z)))
    return float(ua), float(p)


def _norm_cdf(z: float) -> float:
    """Standard normal CDF via erf, so no scipy dependency."""
    import math
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def cohens_d(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = len(a), len(b)
    pooled = np.sqrt(((na - 1) * np.var(a, ddof=1) + (nb - 1) * np.var(b, ddof=1)) / (na + nb - 2))
    return float((a.mean() - b.mean()) / pooled) if pooled > 0 else 0.0


def true_drift(observed_mean: float, null_mean: float) -> float:
    """Strip sampling noise out of a mean absolute difference.

    Under a normal approximation E|d| = sqrt(2/pi) * sd, and the observed and
    noise variances add, so the real season-over-season movement is
    sqrt(max(0, obs^2 - null^2)) on the same E|d| scale.
    """
    return float(np.sqrt(max(0.0, observed_mean ** 2 - null_mean ** 2)))


# --------------------------------------------------------------------------- #
# printing

def show(title: str, frame: pd.DataFrame, floats: int = 4) -> None:
    print("\n" + title)
    if frame is None or frame.empty:
        print("  (empty)")
        return
    disp = frame.copy()
    for col in disp.columns:
        if disp[col].dtype.kind == "f":
            disp[col] = disp[col].map(lambda v: ("{:." + str(floats) + "f}").format(v)
                                      if pd.notna(v) else "-")
        else:
            disp[col] = disp[col].astype(str)
    widths = [max(len(str(c)), int(disp[c].str.len().max())) for c in disp.columns]
    print("  " + "  ".join(str(c).rjust(w) for c, w in zip(disp.columns, widths)))
    for row in disp.itertuples(index=False):
        print("  " + "  ".join(str(v).rjust(w) for v, w in zip(row, widths)))


def summary_row(label: str, x: np.ndarray) -> Dict[str, Any]:
    q = quartiles(x)
    q["group"] = label
    return {k: q[k] for k in ("group", "n", "min", "q1", "median", "mean", "q3", "p90", "max", "sd")}


# --------------------------------------------------------------------------- #
# 5. predictive test

def _score_season(df: pd.DataFrame, test_season: int) -> pd.DataFrame:
    """Train on every season before `test_season`, score that season."""
    season = pd.to_numeric(df["season"])
    train, test = df[season < test_season], df[season == test_season]
    tables = tendency.build(train, half_life=1.0)
    scored = backtest.predict(tables, test, backtest.global_rate(train))
    scored = scored[pd.to_numeric(scored["pred"]).notna()].reset_index(drop=True)
    scored.attrs["train_seasons"] = tables["all_seasons"]
    scored.attrs["train_plays"] = tables["plays"]
    return scored


def _group_stats(grp: pd.DataFrame, label: str, total: int) -> Dict[str, Any]:
    pred, actual = backtest._arrays(grp, "pred")
    base, _ = backtest._arrays(grp, "base_situation")
    b_eng, b_sit = backtest.brier(pred, actual), backtest.brier(base, actual)
    weight, b_best = backtest.best_weight(grp)
    return {"group": label, "teams": int(grp["team"].nunique()), "plays": len(grp),
            "share": len(grp) / float(total),
            "brier_engine": b_eng, "brier_situation": b_sit,
            "skill_vs_situation": 1.0 - b_eng / b_sit,
            "best_team_weight": weight, "brier_at_best": b_best}


def predictive_split(trans: pd.DataFrame) -> None:
    """The decisive test: does a coach change make the team's own history worse?

    The intervention regime keying stands for is "trust the team's own history
    less when the staff turned over". `backtest.best_weight` measures exactly
    that on held-out data, so the question becomes whether the optimal weight on
    the team number is lower for the teams that changed, and by how much Brier
    a regime-aware weight buys over one global weight.
    """
    df = schema.read_plays(PLAYS_CFB)
    scored = _score_season(df, 2025)
    kind = trans[trans["season"] == 2025].set_index("school")["change_kind"].to_dict()
    labels = {"offseason": "new coach", "in_season": "in-season takeover", "none": "same coach"}
    scored["group"] = [labels.get(kind.get(t), "not FBS-matched") for t in scored["team"]]
    order = ("new coach", "same coach", "in-season takeover", "not FBS-matched")
    print("\n  trained on {} ({:,} eligible), scored {:,} held-out 2025 plays".format(
        scored.attrs["train_seasons"], scored.attrs["train_plays"], len(scored)))

    show("5. HELD-OUT 2025, split by whether the head coach changed for 2025",
         pd.DataFrame([_group_stats(scored[scored["group"] == g], g, len(scored))
                       for g in order if not scored[scored["group"] == g].empty]), 5)

    rung1 = scored[scored["rung"] == 1]
    show("5b. same, rung 1 only (team, exact bucket, the strongest team claim)",
         pd.DataFrame([_group_stats(rung1[rung1["group"] == g], g, len(rung1))
                       for g in ("new coach", "same coach")]), 5)

    _staleness_ladder(scored, trans)
    _value_of_regime_keying(df, scored, trans)


def _staleness_ladder(scored: pd.DataFrame, trans: pd.DataFrame) -> None:
    """Confound control: how stale is the training data, in seasons.

    Coach changes cluster at bad, volatile programs, so a raw changed/unchanged
    split could be measuring volatility rather than regime. The regime story
    makes a sharper prediction: degradation should track *how much* of the
    training window predates the current staff. Training is 2023 + 2024, so a
    team that changed for 2025 has both seasons stale, one that changed for 2024
    has only 2023 stale, and one that changed neither year has none.
    """
    ch25 = set(trans[(trans["season"] == 2025) & (trans["change_kind"] == "offseason")]["school"])
    ch24 = set(trans[(trans["season"] == 2024) & (trans["change_kind"] == "offseason")]["school"])
    known = set(trans[trans["season"] == 2025]["school"]) & set(trans[trans["season"] == 2024]["school"])
    label = np.where(scored["team"].isin(ch25), "both train seasons stale",
                     np.where(scored["team"].isin(ch24), "2023 stale, 2024 current",
                              np.where(scored["team"].isin(known), "no change since 2023", "unmatched")))
    tagged = scored.assign(stale=label)
    order = ["both train seasons stale", "2023 stale, 2024 current", "no change since 2023"]
    show("5c. CONFOUND CONTROL: degradation vs how much of the training window predates the staff",
         pd.DataFrame([_group_stats(tagged[tagged["stale"] == g], g, len(tagged))
                       for g in order if not tagged[tagged["stale"] == g].empty]), 5)


def _value_of_regime_keying(df: pd.DataFrame, scored: pd.DataFrame, trans: pd.DataFrame) -> None:
    """What the whole hand-maintained table would actually buy, in Brier points.

    Two fits, both reported, because the gap between them is the honest cost of
    fitting on the thing you score:

    * in-sample ceiling - group weights fitted on 2025 and scored on 2025. No
      real system can do better than this, so it is the upper bound on the payoff.
    * out-of-sample     - group weights fitted on the 2024 holdout (train 2023,
      score 2024, split by the 2024 coach change) and applied to 2025. This is
      what shipping the table would really have earned.
    """
    actual = scored["actual"].to_numpy(dtype="float64")
    changed_mask = (scored["group"] == "new coach").to_numpy()

    global_w, global_b = backtest.best_weight(scored)
    w_ch, _ = backtest.best_weight(scored[changed_mask])
    w_st, _ = backtest.best_weight(scored[~changed_mask])
    split_pred = np.where(changed_mask, backtest._blend(scored, w_ch), backtest._blend(scored, w_st))
    split_b = backtest.brier(split_pred, actual)

    prior = _score_season(df[pd.to_numeric(df["season"]) < 2025], 2024)
    prior_changed = set(trans[(trans["season"] == 2024) & (trans["change_kind"] == "offseason")]["school"])
    pm = prior["team"].isin(prior_changed).to_numpy()
    oos_ch, _ = backtest.best_weight(prior[pm])
    oos_st, _ = backtest.best_weight(prior[~pm])
    oos_global, _ = backtest.best_weight(prior)
    oos_split_b = backtest.brier(
        np.where(changed_mask, backtest._blend(scored, oos_ch), backtest._blend(scored, oos_st)), actual)
    oos_global_b = backtest.brier(backtest._blend(scored, oos_global), actual)

    base_b = backtest.brier(scored["base_situation"].to_numpy(dtype="float64"), actual)
    ship_b = backtest.brier(pd.to_numeric(scored["pred"]).to_numpy(dtype="float64"), actual)
    show("6. WHAT A REGIME TABLE WOULD BUY, on {:,} held-out 2025 plays".format(len(scored)),
         pd.DataFrame([
             {"policy": "engine as shipped (team weight 1.00)", "brier": ship_b,
              "vs_best_regime_blind": ship_b - global_b},
             {"policy": "situation baseline, no team at all (0.00)", "brier": base_b,
              "vs_best_regime_blind": base_b - global_b},
             {"policy": "one global weight, fitted in-sample w={:.2f}".format(global_w),
              "brier": global_b, "vs_best_regime_blind": 0.0},
             {"policy": "regime-aware weights, fitted in-sample ch={:.2f} same={:.2f}".format(w_ch, w_st),
              "brier": split_b, "vs_best_regime_blind": split_b - global_b},
             {"policy": "one global weight, fitted on 2024 w={:.2f}".format(oos_global),
              "brier": oos_global_b, "vs_best_regime_blind": oos_global_b - global_b},
             {"policy": "regime-aware, fitted on 2024 ch={:.2f} same={:.2f}".format(oos_ch, oos_st),
              "brier": oos_split_b, "vs_best_regime_blind": oos_split_b - global_b},
         ]), 5)
    print("  in-sample ceiling on regime keying: {:+.5f} Brier vs one global weight ({:+.3%} relative)".format(
        split_b - global_b, split_b / global_b - 1.0))
    print("  honest out-of-sample:               {:+.5f} Brier vs the same weight fitted the same way "
          "({:+.3%} relative)".format(oos_split_b - oos_global_b, oos_split_b / oos_global_b - 1.0))
    print("  for scale, dropping team attribution entirely costs {:+.5f} and the shipped engine "
          "costs {:+.5f}".format(base_b - global_b, ship_b - global_b))
    ch_only = scored[changed_mask]
    ch_actual = ch_only["actual"].to_numpy(dtype="float64")
    print("  restricted to the {:,} plays regime keying would touch: global w={:.2f} {:.5f} -> "
          "regime w={:.2f} {:.5f}, a gain of {:+.5f} ({:+.2%}) on those plays alone".format(
              len(ch_only), global_w, backtest.brier(backtest._blend(ch_only, global_w), ch_actual),
              w_ch, backtest.brier(backtest._blend(ch_only, w_ch), ch_actual),
              backtest.brier(backtest._blend(ch_only, w_ch), ch_actual)
              - backtest.brier(backtest._blend(ch_only, global_w), ch_actual),
              backtest.brier(backtest._blend(ch_only, w_ch), ch_actual)
              / backtest.brier(backtest._blend(ch_only, global_w), ch_actual) - 1.0))
    print("  accuracy: shipped {:.4f} | global w {:.4f} | regime-aware in-sample {:.4f}".format(
        backtest.accuracy(pd.to_numeric(scored["pred"]).to_numpy(dtype="float64"), actual),
        backtest.accuracy(backtest._blend(scored, global_w), actual),
        backtest.accuracy(split_pred, actual)))

    # What the user would actually see: how far the card's stated pass rate lands
    # from what the team really did in that bucket this season.
    err = np.abs(pd.to_numeric(scored["pred"]).to_numpy(dtype="float64")
                 - scored.groupby(["team", "key"])["actual"].transform("mean").to_numpy(dtype="float64"))
    show("6b. CARD-COPY ERROR: |stated pass rate - what that team actually did in that bucket in 2025|",
         pd.DataFrame([{"group": g,
                        "plays": int((scored["group"] == g).sum()),
                        "mean_abs_error": float(err[(scored["group"] == g).to_numpy()].mean()),
                        "median": float(np.median(err[(scored["group"] == g).to_numpy()])),
                        "share_off_by_20pts": float((err[(scored["group"] == g).to_numpy()] > 0.20).mean())}
                       for g in ("new coach", "same coach")]), 4)


# --------------------------------------------------------------------------- #

def main() -> None:
    api_key = ingest_cfb.load_api_key()
    payloads = {y: fetch_coaches(y, api_key) for y in SEASONS}
    frames = {y: coach_rows(payloads[y], y) for y in SEASONS}
    primary = primary_coaches(frames)

    print("=" * 100)
    print("REGIME MAGNITUDE / CFB {}".format(list(SEASONS)))
    print("  /coaches records: " + ", ".join(
        "{}: {} records, {} schools".format(y, len(payloads[y]), frames[y]["school"].nunique())
        for y in SEASONS))

    trans = transitions(primary)
    show("0. HEAD COACH TURNOVER by offseason", pd.DataFrame([
        {"offseason": "{}->{}".format(p, c),
         "schools_matched": int(len(g)),
         "changed": int(g["changed"].sum()),
         "turnover_rate": float(g["changed"].mean()),
         "offseason_hire": int((g["change_kind"] == "offseason").sum()),
         "in_season_takeover": int((g["change_kind"] == "in_season").sum()),
         "offseason_rate": float((g["change_kind"] == "offseason").mean())}
        for (p, c), g in trans.groupby(["prev_season", "season"])]), 4)

    counts = bucket_counts(schema.read_plays(PLAYS_CFB))
    print("\n  bucket counts: {:,} team-season-bucket cells, {} teams, {} buckets".format(
        len(counts), counts["team"].nunique(), counts["bucket"].nunique()))
    unmatched = sorted(set(trans["school"]) - set(counts["team"]))
    print("  schools in /coaches with no plays under that name: {} {}".format(
        len(unmatched), unmatched[:8]))

    table = shift_table(counts, trans)
    print("\n  usable team-season pairs (buckets need n>={} both seasons, pair weight>={}): {}".format(
        MIN_BUCKET_N, MIN_PAIR_WEIGHT, len(table)))

    ch = table[table["change_kind"] == "offseason"]["shift"].to_numpy()
    st = table[table["change_kind"] == "none"]["shift"].to_numpy()
    mid = table[table["change_kind"] == "in_season"]["shift"].to_numpy()
    ch_null = table[table["change_kind"] == "offseason"]["null_shift"].to_numpy()
    st_null = table[table["change_kind"] == "none"]["null_shift"].to_numpy()

    show("2. SEASON-OVER-SEASON TENDENCY SHIFT (weighted mean |delta pass rate|)",
         pd.DataFrame([summary_row("new coach (offseason hire)", ch),
                       summary_row("same coach", st),
                       summary_row("in-season takeover", mid),
                       summary_row("ALL pairs", table["shift"].to_numpy()),
                       summary_row("sampling-noise floor (new coach)", ch_null),
                       summary_row("sampling-noise floor (same)", st_null)]), 4)

    u, p = mann_whitney(ch, st)
    print("\n3. EFFECT SIZE, new coach (offseason hire) vs same coach")
    print("  median          {:.4f} vs {:.4f}   (difference {:+.4f} pass-rate points, {:+.1%} relative)".format(
        np.median(ch), np.median(st), np.median(ch) - np.median(st),
        np.median(ch) / np.median(st) - 1.0))
    print("  mean            {:.4f} vs {:.4f}   (difference {:+.4f})".format(
        ch.mean(), st.mean(), ch.mean() - st.mean()))
    print("  Cliff's delta   {:+.4f}   (0 = coin flip, |0.15| negligible, |0.33| small, |0.47| medium)".format(
        cliffs_delta(ch, st)))
    print("  Cohen's d       {:+.4f}".format(cohens_d(ch, st)))
    print("  Mann-Whitney U  {:.0f}, two-sided p = {:.4f}".format(u, p))
    print("  noise floor     {:.4f} (changed) / {:.4f} (same): pure sampling, no real movement".format(
        ch_null.mean(), st_null.mean()))
    print("  drift above noise, changed {:.4f} | same {:.4f} | the regime-attributable part {:.4f}".format(
        true_drift(ch.mean(), ch_null.mean()), true_drift(st.mean(), st_null.mean()),
        true_drift(ch.mean(), ch_null.mean()) - true_drift(st.mean(), st_null.mean())))

    show("3b. SENSITIVITY to the per-bucket sample floor", pd.DataFrame([
        _sensitivity(counts, trans, floor) for floor in SENSITIVITY_FLOORS]), 4)

    cols = ["school", "season", "buckets", "weight", "shift", "null_shift", "prev_coach", "coach"]
    show("3c. LARGEST SHIFTS OVERALL (top 12, any cause)",
         table.sort_values("shift", ascending=False)
              .head(12)[["change_kind"] + cols].reset_index(drop=True), 4)
    show("3d. LARGEST SHIFTS AMONG OFFSEASON COACH CHANGES (top 12)",
         table[table["change_kind"] == "offseason"].sort_values("shift", ascending=False)
              .head(12)[cols].reset_index(drop=True), 4)
    show("3e. SMALLEST SHIFTS AMONG OFFSEASON COACH CHANGES (bottom 8: new coach, same tendencies)",
         table[table["change_kind"] == "offseason"].sort_values("shift")
              .head(8)[cols].reset_index(drop=True), 4)
    show("3f. BIGGEST STABLE-STAFF SHIFTS (top 8 with no coach change: the drift regime keying cannot see)",
         table[table["change_kind"] == "none"].sort_values("shift", ascending=False)
              .head(8)[cols].reset_index(drop=True), 4)

    print("\n4. EXPOSURE")
    for (p_yr, c_yr), g in trans.groupby(["prev_season", "season"]):
        print("  {}->{}: {}/{} FBS schools changed head coach ({:.1%}), of which {} were offseason "
              "hires ({:.1%}) and {} were in-season takeovers".format(
                  p_yr, c_yr, int(g["changed"].sum()), len(g), g["changed"].mean(),
                  int((g["change_kind"] == "offseason").sum()),
                  (g["change_kind"] == "offseason").mean(),
                  int((g["change_kind"] == "in_season").sum())))
    changed_2025 = set(trans[(trans["season"] == 2025) & (trans["change_kind"] == "offseason")]["school"])
    all_2025 = set(trans[trans["season"] == 2025]["school"])
    plays_2025 = counts[counts["season"] == 2025]
    tot = plays_2025["n"].sum()
    hit = plays_2025[plays_2025["team"].isin(changed_2025)]["n"].sum()
    fbs = plays_2025[plays_2025["team"].isin(all_2025)]["n"].sum()
    print("  2025 eligible bucketable snaps: {:,} total, {:,} by an FBS-matched offense".format(
        int(tot), int(fbs)))
    print("  snaps by an offense whose head coach changed for 2025: {:,} ({:.1%} of all, {:.1%} of FBS-matched)".format(
        int(hit), hit / float(tot), hit / float(fbs)))

    predictive_split(trans)


def _sensitivity(counts: pd.DataFrame, trans: pd.DataFrame, floor: int) -> Dict[str, Any]:
    t = shift_table(counts, trans, min_n=floor, with_null=False)
    ch = t[t["change_kind"] == "offseason"]["shift"].to_numpy()
    st = t[t["change_kind"] == "none"]["shift"].to_numpy()
    return {"min_bucket_n": floor, "pairs": len(t), "median_changed": float(np.median(ch)),
            "median_same": float(np.median(st)), "gap": float(np.median(ch) - np.median(st)),
            "cliffs_delta": cliffs_delta(ch, st), "mw_p": mann_whitney(ch, st)[1]}


if __name__ == "__main__":
    main()

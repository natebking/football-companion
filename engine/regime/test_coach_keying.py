"""Does explicit head-coach-regime keying beat plain team keying, tested honestly?

`magnitude.py` measured whether a regime effect exists (it does, weakly) and what
a regime-aware *shrink weight* would buy (0.07% Brier). This file tests the thing
the design doc actually asks for: a tendency table keyed on the coaching regime
instead of the team.

Three variants, built and scored identically. Train 2023-2024, hold out 2025.

    A  team-keyed, current recency decay. The status quo.
    B  regime-keyed, all pre-regime data discarded. Every training row is
       relabelled from `Team` to `Team#{tenure_start}`, and the 2025 query asks
       for the 2025 regime, so prior-staff plays are unreachable at every rung
       (including rung 4, "all seasons", which is regime-restricted too).
    C  regime-keyed with fallback: use the regime block when it clears the
       sample floor, otherwise fall back to the team's full history.

Nothing here reimplements the engine. `tendency.build` does the aggregation,
`tendency.query` walks the ladder, `backtest.predict/brier/calibration` score it.
The only new code is (a) the regime label, (b) two extra selector variants, and
(c) the controls below.

The trap
--------
B trains on less data, so it falls further down the ladder. A loss could be
staleness working as intended being outweighed by thin samples, or it could be
nothing but thin samples. Four controls separate them:

    C2   per-rung selector. At each rung, prefer the regime cell if it clears the
         floor, else the team cell. Rung depth is held constant, so the only
         thing that varies is which plays feed the cell.
    D    placebo. Team-keyed, but each team's training history is randomly
         downsampled to exactly the row count B kept for it. Same sample size,
         no regime information. If B == D, the entire difference from A is
         sample size. Averaged over three seeds.
    rung-matched subset. Plays where A and B both reach rung 1. Same filter,
         same floor, both sides carry >= 30 exact-bucket plays.
    DiD  train on 2024 alone vs 2023 alone, both team-keyed, and compare how
         much the recent season helps teams that changed staff for 2024 against
         teams that did not. Sample size and plain recency are held identical
         across the two groups, so the difference of differences is the part
         attributable to the regime.

Run: .venv/bin/python engine/regime/test_coach_keying.py
"""
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent
ROOT = ENGINE.parent
sys.path.insert(0, str(ENGINE))
sys.path.insert(0, str(HERE))

import backtest  # noqa: E402
import buckets  # noqa: E402
import ingest_cfb  # noqa: E402
import magnitude  # noqa: E402  (coach fetch + cache + table printer, already written)
import schema  # noqa: E402
import tendency  # noqa: E402

PLAYS_CFB = ROOT / "data" / "plays_cfb.parquet"
SEASONS = (2023, 2024, 2025)
TEST_SEASON = 2025
PLACEBO_SEEDS = (11, 12, 13)

GROUP_ORDER = ("changed for 2025", "changed for 2024", "continuous 2023-2025", "unmatched")


# --------------------------------------------------------------------------- #
# 1. regime ids

def tenure_table(primary: pd.DataFrame) -> pd.DataFrame:
    """(school, year) -> the first season of the current head coach's tenure.

    Walks backwards while the primary coach id is unchanged. The window is only
    2023-2025, so a coach already in place in 2023 is left-censored at 2023;
    that is harmless here because the training window starts in 2023 anyway, so
    a censored regime covers every training row either way.
    """
    seen = {(str(r.school), int(r.year)): int(r.coach_id) for r in primary.itertuples(index=False)}
    in_season = {(str(r.school), int(r.year)): bool(r.in_season_change)
                 for r in primary.itertuples(index=False)}
    first = min(int(y) for y in primary["year"].unique())
    rows = []
    for (school, year), cid in sorted(seen.items()):
        start, y = year, year - 1
        while y >= first and seen.get((school, y)) == cid:
            start, y = y, y - 1
        rows.append({"school": school, "year": year, "coach_id": cid, "tenure_start": start,
                     "censored": start == first, "in_season_change": in_season[(school, year)],
                     "regime_id": "{}#{}".format(school, start)})
    return pd.DataFrame(rows)


def regime_series(df: pd.DataFrame, tenure: pd.DataFrame) -> pd.Series:
    """Per-row regime id. Teams with no /coaches record keep their bare name.

    A team outside FBS (or spelled differently in the coach feed) has no regime,
    so it is labelled by team alone and every variant treats it identically.
    That is deliberate: it keeps the unmatched rows in the denominator instead of
    quietly deleting the hardest cases.
    """
    key = pd.MultiIndex.from_arrays([df["offense"].astype(str),
                                     pd.to_numeric(df["season"]).astype(int)])
    lookup = tenure.set_index(["school", "year"])["regime_id"]
    out = pd.Series(lookup.reindex(key).to_numpy(), index=df.index, dtype=object)
    return out.fillna(df["offense"].astype(str))


def test_regime_map(tenure: pd.DataFrame, season: int) -> Dict[str, str]:
    """team -> the regime id it plays under in the held-out season."""
    cur = tenure[tenure["year"] == season]
    return dict(zip(cur["school"].astype(str), cur["regime_id"].astype(str)))


def group_map(tenure: pd.DataFrame, season: int) -> Dict[str, str]:
    cur = tenure[tenure["year"] == season]
    out = {}
    for row in cur.itertuples(index=False):
        if row.tenure_start == season:
            out[str(row.school)] = "changed for {}".format(season)
        elif row.tenure_start == season - 1:
            out[str(row.school)] = "changed for {}".format(season - 1)
        else:
            out[str(row.school)] = "continuous {}-{}".format(row.tenure_start, season)
    return out


# --------------------------------------------------------------------------- #
# 2. variants

def score_with(tables: Dict[str, Any], test: pd.DataFrame, offense: pd.Series,
               naive: float) -> pd.DataFrame:
    """`backtest.predict` with the offense column swapped for a regime label."""
    swapped = test.copy()
    swapped["offense"] = offense.reindex(test.index).to_numpy()
    return backtest.predict(tables, swapped, naive)


def _stats_at(tables: Dict[str, Any], name: Optional[str], down: int, distance: int,
              ytg: int) -> List[Optional[Dict[str, Any]]]:
    """The four team-side ladder cells for one key, unfiltered by the sample floor."""
    key = buckets.bucket(down, distance, ytg)
    return [tendency._get(tables["team_exact"], name, key),
            tendency._get(tables["team_pooled"], name, key),
            tendency._get(tables["team_distance"], name, buckets.distance_key(down, distance)),
            tendency._get(tables["team_down"], name, buckets.down_key(down))]


def per_rung_block(t_team: Dict[str, Any], t_reg: Dict[str, Any], team: str, regime: str,
                   down: int, distance: int, ytg: int) -> Dict[str, Any]:
    """Variant C2: prefer the regime cell at each rung, else the team cell.

    Holds rung depth constant between the two data sources, which is what makes
    it a control for B's ladder descent rather than another version of B.
    """
    key = buckets.bucket(down, distance, ytg)
    floor = t_team.get("min_sample", tendency.MIN_SAMPLE)
    lg = t_team["league_exact"].get(key)
    lg_rate = lg["pass_rate"] if lg else None
    reg_cells = _stats_at(t_reg, regime, down, distance, ytg)
    team_cells = _stats_at(t_team, team, down, distance, ytg)
    for rung, (rc, tc) in enumerate(zip(reg_cells, team_cells), start=1):
        if rc is not None and rc["sample_size"] >= floor:
            return {"rung": rung, "pred": rc["pass_rate"], "sample_size": rc["sample_size"],
                    "source": "regime"}
        if tc is not None and tc["sample_size"] >= floor:
            return {"rung": rung, "pred": tc["pass_rate"], "sample_size": tc["sample_size"],
                    "source": "team"}
    return {"rung": 5, "pred": lg_rate, "sample_size": lg["sample_size"] if lg else 0,
            "source": "league"}


def combine_c(a: pd.DataFrame, b: pd.DataFrame) -> pd.DataFrame:
    """Variant C: regime block when it cleared the floor (rung < 5), else team block."""
    use_b = (b["rung"].to_numpy() < 5)
    out = a.copy()
    out["pred"] = np.where(use_b, pd.to_numeric(b["pred"]).to_numpy(dtype="float64"),
                           pd.to_numeric(a["pred"]).to_numpy(dtype="float64"))
    out["rung"] = np.where(use_b, b["rung"].to_numpy(), a["rung"].to_numpy())
    out["sample_size"] = np.where(use_b, b["sample_size"].to_numpy(), a["sample_size"].to_numpy())
    out["confidence"] = [tendency.RUNG_CONFIDENCE[r] for r in out["rung"]]
    out.attrs["from_regime"] = int(use_b.sum())
    return out


def combine_c2(a: pd.DataFrame, t_team: Dict[str, Any], t_reg: Dict[str, Any],
               regime_of: Dict[str, str]) -> pd.DataFrame:
    """Variant C2, memoised per (team, bucket key) exactly like `backtest.predict`."""
    memo: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for team, key in a.groupby(["team", "key"]).size().index:
        memo[(team, key)] = per_rung_block(t_team, t_reg, team, regime_of.get(team, team),
                                           *backtest._rep(key))
    blocks = [memo[(t, k)] for t, k in zip(a["team"], a["key"])]
    out = a.copy()
    out["pred"] = [blk["pred"] for blk in blocks]
    out["rung"] = [blk["rung"] for blk in blocks]
    out["sample_size"] = [blk["sample_size"] for blk in blocks]
    out["confidence"] = [tendency.RUNG_CONFIDENCE[blk["rung"]] for blk in blocks]
    out.attrs["source_counts"] = pd.Series([blk["source"] for blk in blocks]).value_counts().to_dict()
    return out


def downsample(el_train: pd.DataFrame, keep_n: Dict[str, int], seed: int) -> pd.DataFrame:
    """Placebo D: each team's training rows cut at random to `keep_n[team]`."""
    rng = np.random.RandomState(seed)
    parts = []
    for team, grp in el_train.groupby(el_train["offense"].astype(str), sort=True):
        k = int(keep_n.get(team, len(grp)))
        if k >= len(grp):
            parts.append(grp)
        elif k > 0:
            parts.append(grp.iloc[np.sort(rng.choice(len(grp), size=k, replace=False))])
    return pd.concat(parts)


# --------------------------------------------------------------------------- #
# 3. scoring

def metrics(frame: pd.DataFrame, label: str, col: str = "pred") -> Dict[str, Any]:
    pred, actual = backtest._arrays(frame, col)
    base, _ = backtest._arrays(frame, "base_situation")
    b_eng, b_sit = backtest.brier(pred, actual), backtest.brier(base, actual)
    _, ece = backtest.calibration(frame, col)
    return {"variant": label, "plays": len(frame), "brier": b_eng,
            "vs_A": np.nan, "skill_vs_situation": 1.0 - b_eng / b_sit,
            "accuracy": backtest.accuracy(pred, actual), "ece": ece,
            "mean_n": float(pd.to_numeric(frame["sample_size"]).mean())}


def compare(variants: List[Tuple[str, pd.DataFrame]], title: str, mask: Optional[np.ndarray] = None) -> None:
    rows = []
    for label, frame in variants:
        sub = frame if mask is None else frame[mask]
        if len(sub) == 0:
            continue
        rows.append(metrics(sub, label))
    if not rows:
        magnitude.show(title, pd.DataFrame())
        return
    base = rows[0]["brier"]
    for row in rows:
        row["vs_A"] = row["brier"] - base
    magnitude.show(title, pd.DataFrame(rows), 5)


def cluster_bootstrap(x: pd.DataFrame, y: pd.DataFrame, team: np.ndarray,
                      mask: Optional[np.ndarray] = None, draws: int = 2000,
                      seed: int = 7) -> Tuple[float, float, float]:
    """Paired Brier difference (x - y) with a team-clustered bootstrap interval.

    Plays by the same offense are not independent, so the resampling unit is the
    team. Squared errors are pre-summed per team, which makes each resample O(teams)
    and the interval exact rather than subsampled.
    """
    if mask is not None:
        x, y, team = x[mask], y[mask], team[mask]
    ax = (pd.to_numeric(x["pred"]).to_numpy(dtype="float64") - x["actual"].to_numpy(dtype="float64")) ** 2
    ay = (pd.to_numeric(y["pred"]).to_numpy(dtype="float64") - y["actual"].to_numpy(dtype="float64")) ** 2
    codes, uniq = pd.factorize(team)
    se_x = np.bincount(codes, weights=ax, minlength=len(uniq))
    se_y = np.bincount(codes, weights=ay, minlength=len(uniq))
    n = np.bincount(codes, minlength=len(uniq)).astype("float64")
    point = float((se_x.sum() - se_y.sum()) / n.sum())
    rng = np.random.RandomState(seed)
    idx = rng.randint(0, len(uniq), size=(draws, len(uniq)))
    diffs = (se_x[idx].sum(axis=1) - se_y[idx].sum(axis=1)) / n[idx].sum(axis=1)
    return point, float(np.percentile(diffs, 2.5)), float(np.percentile(diffs, 97.5))


def rung_distribution(variants: List[Tuple[str, pd.DataFrame]],
                      mask: Optional[np.ndarray] = None) -> pd.DataFrame:
    rows = []
    for label, frame in variants:
        sub = frame if mask is None else frame[mask]
        counts = sub.groupby("rung").size()
        total = float(len(sub))
        row = {"variant": label, "plays": len(sub)}
        for rung in (1, 2, 3, 4, 5):
            row["rung{}".format(rung)] = counts.get(rung, 0) / total if total else 0.0
        row["mean_n"] = float(pd.to_numeric(sub["sample_size"]).mean())
        rows.append(row)
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #

def main() -> None:
    api_key = ingest_cfb.load_api_key()
    payloads = {y: magnitude.fetch_coaches(y, api_key) for y in SEASONS}
    primary = magnitude.primary_coaches({y: magnitude.coach_rows(payloads[y], y) for y in SEASONS})
    tenure = tenure_table(primary)

    df = schema.read_plays(PLAYS_CFB)
    season = pd.to_numeric(df["season"])
    train_raw, test = df[season < TEST_SEASON], df[season == TEST_SEASON]
    el_train = tendency.eligible(train_raw)
    naive = backtest.global_rate(train_raw)

    reg_train = regime_series(el_train, tenure)
    reg_test_map = test_regime_map(tenure, TEST_SEASON)
    groups = group_map(tenure, TEST_SEASON)

    print("=" * 104)
    print("COACH-REGIME KEYING / CFB   train {} -> hold out {}".format(
        sorted(int(s) for s in el_train["season"].unique()), TEST_SEASON))
    print("  {:,} eligible training plays, {:,} raw held-out rows".format(len(el_train), len(test)))
    cur = tenure[tenure["year"] == TEST_SEASON]
    print("  {} FBS schools with a {} head coach on file; tenure starts: {}".format(
        len(cur), TEST_SEASON, dict(sorted(cur["tenure_start"].value_counts().items()))))
    print("  of the {} whose tenure began in {}, {} took over in season".format(
        int((cur["tenure_start"] == TEST_SEASON).sum()), TEST_SEASON,
        int((cur["in_season_change"] & (cur["tenure_start"] == TEST_SEASON)).sum())))
    print("  distinct regime ids in the training frame: {} (vs {} team names)".format(
        reg_train.nunique(), el_train["offense"].nunique()))
    # magnitude.py counted 35 changes into 2025 from schools present in BOTH coach
    # years; a school new to the 2025 list has no predecessor to compare against
    # there but still starts a fresh regime here, so the counts differ by exactly
    # those schools. Named rather than reconciled away.
    prior_schools = set(tenure[tenure["year"] == TEST_SEASON - 1]["school"])
    fresh = sorted(set(cur[cur["tenure_start"] == TEST_SEASON]["school"]) - prior_schools)
    print("  of those {}, {} are schools absent from the {} coach list entirely: {}".format(
        int((cur["tenure_start"] == TEST_SEASON).sum()), len(fresh), TEST_SEASON - 1, fresh))

    # ---- build the three variants ----------------------------------------- #
    t_team = tendency.build(el_train)
    t_reg = tendency.build(el_train.assign(offense=reg_train.to_numpy()))

    kept = {}
    for team, rid in reg_test_map.items():
        kept[team] = int((reg_train.to_numpy() == rid).sum())
    for team in el_train["offense"].astype(str).unique():
        kept.setdefault(team, int((el_train["offense"].astype(str) == team).sum()))

    test_team = test["offense"].astype(str)
    test_regime = test_team.map(lambda t: reg_test_map.get(t, t))

    a = score_with(t_team, test, test_team, naive)
    b = score_with(t_reg, test, test_regime, naive)
    if not np.array_equal(a["actual"].to_numpy(), b["actual"].to_numpy()):
        raise RuntimeError("variant frames are not row-aligned")
    c = combine_c(a, b)
    c2 = combine_c2(a, t_team, t_reg, reg_test_map)

    placebo = []
    for seed in PLACEBO_SEEDS:
        t_d = tendency.build(downsample(el_train, kept, seed))
        placebo.append(score_with(t_d, test, test_team, naive))

    variants: List[Tuple[str, pd.DataFrame]] = [
        ("A team-keyed (shipped)", a),
        ("B regime-keyed, pre-regime discarded", b),
        ("C regime, fall back to team", c),
        ("C2 regime per rung, else team", c2),
        ("D placebo: team, B's sample size", placebo[0]),
    ]

    # rows where any variant has no number at all are dropped from every variant,
    # so all five are scored on an identical play set.
    ok = np.ones(len(a), dtype=bool)
    for _, frame in variants:
        ok &= pd.to_numeric(frame["pred"]).notna().to_numpy()
    for extra in placebo[1:]:
        ok &= pd.to_numeric(extra["pred"]).notna().to_numpy()
    dropped = int((~ok).sum())
    variants = [(label, frame[ok].reset_index(drop=True)) for label, frame in variants]
    placebo = [p[ok].reset_index(drop=True) for p in placebo]
    a, b, c, c2 = variants[0][1], variants[1][1], variants[2][1], variants[3][1]
    print("  held-out plays scored: {:,}  (dropped {} with no number under some variant)".format(
        len(a), dropped))

    team_col = a["team"].to_numpy()
    grp = np.array([groups.get(t, "unmatched") for t in team_col])
    labels = [g for g in GROUP_ORDER if (grp == g).any()]
    magnitude.show("0. HELD-OUT PLAYS BY REGIME STATUS", pd.DataFrame([
        {"group": g, "teams": int(pd.unique(team_col[grp == g]).size),
         "plays": int((grp == g).sum()), "share": float((grp == g).mean()),
         "train_plays_kept_by_B": int(sum(kept.get(t, 0) for t in pd.unique(team_col[grp == g]))),
         "train_plays_available": int(sum(
             (el_train["offense"].astype(str) == t).sum() for t in pd.unique(team_col[grp == g])))}
        for g in labels]), 4)

    # ---- correctness checks ------------------------------------------------ #
    print("\n0b. CHECKS")
    stable = grp == "continuous 2023-2025"
    same = np.allclose(pd.to_numeric(a["pred"]).to_numpy()[stable],
                       pd.to_numeric(b["pred"]).to_numpy()[stable])
    print("  A and B identical on unchanged-staff plays (must be True): {}".format(same))
    new25 = grp == "changed for 2025"
    print("  B rung-5 (no team number at all) share on new-staff plays: {:.1%}, on stable plays {:.1%}".format(
        float((b["rung"].to_numpy()[new25] == 5).mean()), float((b["rung"].to_numpy()[stable] == 5).mean())))
    print("  placebo D training rows {:,} vs B's {:,} (must match)".format(
        int(sum(min(kept.get(t, 0), int((el_train["offense"].astype(str) == t).sum()))
                for t in el_train["offense"].astype(str).unique())),
        int(sum((reg_train.to_numpy() == reg_test_map.get(t, t)).sum()
                for t in el_train["offense"].astype(str).unique()
                if t in reg_test_map) + sum(
            int((el_train["offense"].astype(str) == t).sum())
            for t in el_train["offense"].astype(str).unique() if t not in reg_test_map))))
    print("  variant C took the regime block on {:,} of {:,} plays ({:.1%})".format(
        c.attrs["from_regime"], len(c), c.attrs["from_regime"] / float(len(c))))
    print("  variant C2 block source: {}".format(c2.attrs["source_counts"]))

    # ---- headline ---------------------------------------------------------- #
    compare(variants, "1. OVERALL, all {:,} held-out plays".format(len(a)))
    print("  situation baseline (no team at all) Brier {:.5f}   league-average Brier {:.5f}".format(
        backtest.brier(*backtest._arrays(a, "base_situation")),
        backtest.brier(*backtest._arrays(a, "base_global"))))
    pl = [backtest.brier(*backtest._arrays(p, "pred")) for p in placebo]
    print("  placebo D across seeds {}: Brier {} (mean {:.5f}, sd {:.5f})".format(
        list(PLACEBO_SEEDS), ["{:.5f}".format(v) for v in pl], float(np.mean(pl)), float(np.std(pl, ddof=1))))

    magnitude.show("2. RUNG DISTRIBUTION, all held-out plays (share of plays)",
                   rung_distribution(variants), 4)

    for g in labels:
        mask = grp == g
        compare(variants, "3. {} ({:,} plays, {} teams)".format(
            g.upper(), int(mask.sum()), int(pd.unique(team_col[mask]).size)), mask)
        magnitude.show("   rung distribution, {}".format(g), rung_distribution(variants, mask), 4)

    # ---- calibration ------------------------------------------------------- #
    for label, frame in variants[:4]:
        cal, ece = backtest.calibration(frame)
        magnitude.show("4. CALIBRATION, {}   ECE {:.5f}".format(label, ece), cal, 4)

    changed = grp != "continuous 2023-2025"
    for label, frame in variants[:4]:
        cal, ece = backtest.calibration(frame[changed])
        magnitude.show("4b. CALIBRATION on changed-staff plays only, {}   ECE {:.5f}".format(label, ece),
                       cal, 4)

    # ---- sample size vs regime -------------------------------------------- #
    print("\n5. SEPARATING SAMPLE SIZE FROM REGIME")
    for g in labels:
        mask = grp == g
        if not mask.any():
            continue
        b_a = backtest.brier(*backtest._arrays(a[mask], "pred"))
        b_b = backtest.brier(*backtest._arrays(b[mask], "pred"))
        b_d = float(np.mean([backtest.brier(*backtest._arrays(p[mask], "pred")) for p in placebo]))
        print("  {:<22} A {:.5f} | B {:.5f} ({:+.5f}) | D same-size placebo {:.5f} ({:+.5f})"
              " -> sample-size part {:+.5f}, regime part {:+.5f}".format(
                  g, b_a, b_b, b_b - b_a, b_d, b_d - b_a, b_d - b_a, b_b - b_d))

    both1 = (a["rung"].to_numpy() == 1) & (b["rung"].to_numpy() == 1)
    print("\n  rung-matched subset: {:,} plays where A and B both reach rung 1 ({:.1%} of all)".format(
        int(both1.sum()), float(both1.mean())))
    compare(variants, "5b. RUNG-MATCHED (A and B both rung 1, ladder depth held constant)", both1)
    for g in labels:
        mask = both1 & (grp == g)
        if mask.sum() < 200:
            print("  {:<22} rung-matched plays: {:,} (too few to score)".format(g, int(mask.sum())))
            continue
        print("  {:<22} rung-matched {:,} plays: A {:.5f} (mean n {:.0f}) | B {:.5f} (mean n {:.0f})".format(
            g, int(mask.sum()), backtest.brier(*backtest._arrays(a[mask], "pred")),
            float(pd.to_numeric(a[mask]["sample_size"]).mean()),
            backtest.brier(*backtest._arrays(b[mask], "pred")),
            float(pd.to_numeric(b[mask]["sample_size"]).mean())))

    # ---- is any of this bigger than noise? --------------------------------- #
    d0 = placebo[0]
    contrasts = [
        ("B - A", b, a, None, "all plays"),
        ("C - A", c, a, None, "all plays"),
        ("C2 - A", c2, a, None, "all plays"),
        ("B - A", b, a, grp == "changed for 2024", "changed for 2024"),
        ("B - D (same sample size)", b, d0, grp == "changed for 2024", "changed for 2024"),
        ("C - A", c, a, grp == "changed for 2024", "changed for 2024"),
        ("B - A", b, a, grp == "changed for 2025", "changed for 2025"),
        ("B - D (same sample size)", b, d0, grp == "changed for 2025", "changed for 2025"),
    ]
    rows = []
    for label, x, y, mask, scope in contrasts:
        point, lo, hi = cluster_bootstrap(x, y, team_col, mask)
        rows.append({"contrast": label, "scope": scope,
                     "plays": len(x) if mask is None else int(mask.sum()),
                     "brier_diff": point, "ci_lo": lo, "ci_hi": hi,
                     "sig": "" if lo <= 0 <= hi else "yes"})
    magnitude.show("5c. TEAM-CLUSTERED BOOTSTRAP, 2000 draws (negative = the first variant is better)",
                   pd.DataFrame(rows), 5)

    _did(df, test, test_team, naive, tenure, grp, ok, team_col)

    # ---- the regime knob the engine already has ---------------------------- #
    print("\n6b. THE INCUMBENT'S OWN REGIME KNOB: season recency half-life, team-keyed")
    print("   half-life 1.0 already halves the prior season's weight, which is a soft, "
          "hand-maintenance-free version of the same idea.")
    hl_rows = []
    for hl in (2.0, 1.0, 0.5, 0.25):
        tables = tendency.build(el_train, half_life=hl)
        scored = score_with(tables, test, test_team, naive)[ok].reset_index(drop=True)
        pred, actual_hl = backtest._arrays(scored, "pred")
        hl_rows.append({"half_life": hl, "brier_all": backtest.brier(pred, actual_hl),
                        "brier_changed_2024": backtest.brier(
                            *backtest._arrays(scored[grp == "changed for 2024"], "pred")),
                        "brier_changed_2025": backtest.brier(
                            *backtest._arrays(scored[grp == "changed for 2025"], "pred")),
                        "brier_continuous": backtest.brier(
                            *backtest._arrays(scored[grp == "continuous 2023-2025"], "pred"))})
    magnitude.show("   (half-life 1.0 is the shipped setting; 0.25 weights 2023 at 0.06)",
                   pd.DataFrame(hl_rows), 5)

    # ---- what it would buy -------------------------------------------------- #
    w_a, br_a = backtest.best_weight(a)
    print("\n7. BEST-CASE FRAMING")
    print("  best global shrink on A: w={:.2f}, Brier {:.5f} (A as shipped {:.5f})".format(
        w_a, br_a, backtest.brier(*backtest._arrays(a, "pred"))))
    for label, frame in variants[1:4]:
        w, br = backtest.best_weight(frame)
        print("  best global shrink on {}: w={:.2f}, Brier {:.5f}  -> vs shrunk A {:+.5f}".format(
            label, w, br, br - br_a))
    print("  every number above is scored on the same {:,} held-out 2025 plays; the situation "
          "baseline sits at {:.5f}".format(len(a), backtest.brier(*backtest._arrays(a, "base_situation"))))


def _did(df: pd.DataFrame, test: pd.DataFrame, test_team: pd.Series, naive: float,
         tenure: pd.DataFrame, grp: np.ndarray, ok: np.ndarray, team_col: np.ndarray) -> None:
    """Difference in differences: is a recent season worth more after a staff change?

    Both arms are team-keyed and single-season, so sample size is matched by
    construction. 2024 is more recent than 2023 for every team alike; only the
    "changed for 2024" group has a regime boundary between them. The excess
    benefit of 2024 over 2023 in that group, above the same gap in the stable
    group, is the regime effect with recency and volume differenced out.
    """
    season = pd.to_numeric(df["season"])
    frames = {}
    for year in (2023, 2024):
        tables = tendency.build(df[season == year])
        scored = backtest.predict(tables, test, naive)
        frames[year] = scored[ok].reset_index(drop=True)
    print("\n6. DIFFERENCE IN DIFFERENCES: train on one season only, team-keyed")
    rows = []
    for g in ("changed for 2024", "continuous 2023-2025"):
        mask = grp == g
        if not mask.any():
            continue
        b23 = backtest.brier(*backtest._arrays(frames[2023][mask], "pred"))
        b24 = backtest.brier(*backtest._arrays(frames[2024][mask], "pred"))
        rows.append({"group": g, "plays": int(mask.sum()), "brier_train_2023_only": b23,
                     "brier_train_2024_only": b24, "gain_from_recent_season": b24 - b23})
    magnitude.show("   (2024 is the current regime for 'changed for 2024', 2023 is the prior staff)",
                   pd.DataFrame(rows), 5)
    if len(rows) == 2:
        did = rows[0]["gain_from_recent_season"] - rows[1]["gain_from_recent_season"]
        print("  difference in differences: {:+.5f} Brier".format(did))
        print("  negative means the current-regime season is worth more to a team that changed staff "
              "than the same recency is worth to a team that did not.")
        for g in ("changed for 2024", "continuous 2023-2025"):
            mask = grp == g
            point, lo, hi = cluster_bootstrap(frames[2024], frames[2023], team_col, mask)
            print("  {:<22} 2024-only minus 2023-only: {:+.5f}  95% CI [{:+.5f}, {:+.5f}]".format(
                g, point, lo, hi))


if __name__ == "__main__":
    main()

"""Can the existing season-decay knob already absorb regime change?

`magnitude.py` established that a head-coach change does degrade the team's own
tendency, dose-dependently, but that a single regime-blind shrink toward the
league situation rate recovers ~97% of what a perfect regime table would give.
That leaves one cheaper question unasked: the engine already has a forgetting
mechanism. `tendency.build(half_life=...)` down-weights old seasons
exponentially, fixed at one season by the contract. Nobody has tuned it.

If regime change is real, the fix might be free: shorten the half-life. And if
coach-change teams want a much shorter half-life than stable teams, that is the
same signal a coordinator table would carry, reachable with one float.

What half-life actually controls here
-------------------------------------
The CFB training window is 2023 + 2024, two seasons. Season weight is
0.5 ** ((max_season - season) / half_life), so the newest season is always 1.0
and the whole knob collapses to one number: r = 0.5 ** (1 / half_life), the
weight on 2023 relative to 2024. That makes the sweep a clean one-dimensional
line from r=0 (forget last year entirely) to r=1 (no decay at all), and the
half-life grid is reported with its r so the shape is legible.

Two things the knob does NOT do, both of which matter for reading the results:

* It never touches `sample_size`. The contract keeps `sample_size` as the raw
  play count precisely so old plays cannot buy confidence. So rung reach, and
  therefore which plays get a team number at all, is identical at every
  half-life. Decay moves rates, not the ladder.
* It cannot express within-season recency. There is no week decay, so a
  single-season frame (the NFL parquet) is completely insensitive to it. That is
  measured below rather than asserted.

`seasons=[most recent]` is swept as a separate variant because it is the one
setting that differs: it is r=0 *and* it drops the old season's plays from the
sample count, so it moves the ladder too.

Method
------
1. Hold out the most recent season (`backtest.temporal_split`, unchanged).
2. For each setting, build tables on the training side only and score every
   held-out play. Brier, ECE, accuracy, rung reach.
3. Repeat the sweep restricted to teams whose head coach changed for the held-out
   season, and to teams whose did not, using `magnitude`'s cached CFBD coach
   transitions. If the coach-change group wants a much shorter half-life, the
   parameter is the cheap version of the coordinator table.
4. Score a regime-aware half-life policy honestly: the two group half-lives are
   fitted on the first half of the held-out season and scored on the second half,
   so the number applied is never fitted on the plays it is scored on.
5. Report the league-average-only Brier as the floor, and the best shrink weight
   at every half-life, so the two mechanisms can be compared on one scale.

Run: .venv/bin/python engine/regime/test_recency.py
"""
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent
ROOT = ENGINE.parent
sys.path.insert(0, str(ENGINE))
sys.path.insert(0, str(HERE))

import backtest  # noqa: E402
import schema  # noqa: E402
import tendency  # noqa: E402

import magnitude  # noqa: E402

PLAYS_CFB = ROOT / "data" / "plays_cfb.parquet"
PLAYS_NFL = ROOT / "data" / "plays_nfl.parquet"
COACH_SEASONS = (2023, 2024, 2025)

# 0.05 is the practical hl->0 limit: r = 0.5**20 = 1e-6, so 2023 is forgotten
# while its plays still count toward sample_size. inf is no decay at all.
HALF_LIVES: Tuple[float, ...] = (0.05, 0.125, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0,
                                 3.0, 4.0, 8.0, float("inf"))
CONTRACT_HALF_LIFE = 1.0
CURRENT_ONLY = "current season only"


# --------------------------------------------------------------------------- #
# settings

def _hl_label(hl: float) -> str:
    return "inf" if np.isinf(hl) else "{:g}".format(hl)


def older_season_weight(hl: float) -> float:
    """r: weight the decay puts on the season before the newest training season."""
    return float(0.5 ** (1.0 / hl)) if not np.isinf(hl) else 1.0


def settings(train_seasons: Sequence[int]) -> List[Dict[str, Any]]:
    """The sweep: every half-life over the full window, plus the newest-season-only variant."""
    out: List[Dict[str, Any]] = []
    for hl in HALF_LIVES:
        out.append({"label": "half_life " + _hl_label(hl), "half_life": hl,
                    "seasons": None, "hl_value": hl,
                    "r": older_season_weight(hl), "kind": "decay"})
    newest = max(train_seasons)
    out.append({"label": CURRENT_ONLY, "half_life": 1.0, "seasons": [newest],
                "hl_value": float("nan"), "r": 0.0, "kind": "window"})
    return out


# --------------------------------------------------------------------------- #
# scoring one setting

def score_setting(train: pd.DataFrame, test: pd.DataFrame, naive: float,
                  half_life: float, seasons: Optional[Sequence[int]]) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """Build on the training side only, score every held-out play. No dropping yet."""
    tables = tendency.build(train, seasons=seasons, half_life=half_life)
    scored = backtest.predict(tables, test, naive)
    el = tendency.eligible(train)
    window = int(pd.to_numeric(el["season"]).isin(tables["seasons"]).sum())
    meta = {"train_plays": tables["plays"], "window_plays": window,
            "seasons_weighted": tables["seasons"], "teams": len(tables["teams"])}
    return scored, meta


def sweep(train: pd.DataFrame, test: pd.DataFrame,
          train_seasons: Sequence[int]) -> Tuple[List[Dict[str, Any]], Dict[str, pd.DataFrame], np.ndarray, float]:
    """Score every setting on the identical held-out row set.

    Rows where any setting fails to produce a prediction are dropped from all of
    them, so the Brier scores across the sweep are computed on the same plays and
    the comparison is a comparison of the knob, not of coverage.
    """
    naive = backtest.global_rate(train)
    frames: Dict[str, pd.DataFrame] = {}
    metas: List[Dict[str, Any]] = []
    for cfg in settings(train_seasons):
        scored, meta = score_setting(train, test, naive, cfg["half_life"], cfg["seasons"])
        frames[cfg["label"]] = scored
        meta.update(cfg)
        metas.append(meta)

    lengths = {len(f) for f in frames.values()}
    if len(lengths) != 1:
        raise RuntimeError("settings produced different row counts: {}".format(lengths))
    valid = np.ones(len(next(iter(frames.values()))), dtype=bool)
    for frame in frames.values():
        valid &= pd.to_numeric(frame["pred"]).notna().to_numpy()
    ref = next(iter(frames.values()))
    for frame in frames.values():
        if not np.array_equal(frame["actual"].to_numpy(), ref["actual"].to_numpy()):
            raise RuntimeError("settings disagree on the held-out outcomes")
    frames = {k: v[valid].reset_index(drop=True) for k, v in frames.items()}
    return metas, frames, valid, naive


# --------------------------------------------------------------------------- #
# metrics

def metrics(frame: pd.DataFrame, naive: float) -> Dict[str, Any]:
    pred, actual = backtest._arrays(frame, "pred")
    base_s, _ = backtest._arrays(frame, "base_situation")
    _, ece = backtest.calibration(frame, "pred")
    weight, b_best = backtest.best_weight(frame)
    b = backtest.brier(pred, actual)
    return {"n": len(frame), "brier": b, "ece": ece,
            "accuracy": backtest.accuracy(pred, actual),
            "brier_situation": backtest.brier(base_s, actual),
            "skill_vs_situation": 1.0 - b / backtest.brier(base_s, actual),
            "skill_vs_global": 1.0 - b / backtest.brier(np.full(len(frame), naive), actual),
            "rung1_reach": float((frame["rung"] == 1).mean()),
            "best_team_weight": weight, "brier_at_best_weight": b_best}


def group_brier(frame: pd.DataFrame, mask: np.ndarray) -> float:
    grp = frame[mask]
    pred, actual = backtest._arrays(grp, "pred")
    return backtest.brier(pred, actual)


def best_row(rows: pd.DataFrame, col: str = "brier") -> pd.Series:
    return rows.loc[rows[col].idxmin()]


# --------------------------------------------------------------------------- #
# coach regime labels

def coach_groups(scored_teams: pd.Series, test_season: int) -> Tuple[np.ndarray, pd.DataFrame]:
    """Per held-out play: 'new coach' / 'same coach' / 'in-season takeover' / unmatched."""
    api_key = magnitude.ingest_cfb.load_api_key()
    payloads = {y: magnitude.fetch_coaches(y, api_key) for y in COACH_SEASONS}
    frames = {y: magnitude.coach_rows(payloads[y], y) for y in COACH_SEASONS}
    trans = magnitude.transitions(magnitude.primary_coaches(frames))
    kind = trans[trans["season"] == test_season].set_index("school")["change_kind"].to_dict()
    labels = {"offseason": "new coach", "in_season": "in-season takeover", "none": "same coach"}
    return np.array([labels.get(kind.get(t), "not FBS-matched") for t in scored_teams]), trans


# --------------------------------------------------------------------------- #
# printing

def show(title: str, frame: pd.DataFrame, floats: int = 5) -> None:
    magnitude.show(title, frame, floats)


# --------------------------------------------------------------------------- #
# CFB

def run_cfb() -> None:
    df = schema.read_plays(PLAYS_CFB)
    train, test, label = backtest.temporal_split(df)
    train_seasons = sorted(int(s) for s in train["season"].dropna().unique())
    test_season = int(pd.to_numeric(test["season"]).max())

    print("=" * 104)
    print("RECENCY SWEEP / CFB   file={}".format(PLAYS_CFB.name))
    print("  split: {}".format(label))
    print("  training window is {} seasons, so half_life collapses to one number:".format(len(train_seasons)))
    print("  r = 0.5 ** (1/half_life) = the weight on {} relative to {}".format(
        min(train_seasons), max(train_seasons)))

    metas, frames, valid, naive = sweep(train, test, train_seasons)
    print("  scored {:,} held-out plays on every setting ({} dropped for want of a "
          "prediction under at least one setting)".format(int(valid.sum()), int((~valid).sum())))

    rows = []
    for meta in metas:
        m = metrics(frames[meta["label"]], naive)
        rows.append({"setting": meta["label"], "r_on_{}".format(min(train_seasons)): meta["r"],
                     "plays_in_window": meta["window_plays"],
                     "brier": m["brier"], "ece": m["ece"], "accuracy": m["accuracy"],
                     "rung1_reach": m["rung1_reach"],
                     "skill_vs_situation": m["skill_vs_situation"],
                     "best_shrink_w": m["best_team_weight"],
                     "brier_at_best_w": m["brier_at_best_weight"]})
    table = pd.DataFrame(rows)
    show("1. HALF-LIFE SWEEP on held-out {} (lower Brier and ECE are better)".format(test_season), table)

    actual = frames[CURRENT_ONLY]["actual"].to_numpy(dtype="float64")
    b_global = backtest.brier(np.full(len(actual), naive), actual)
    b_situation = backtest.brier(
        frames["half_life 1"]["base_situation"].to_numpy(dtype="float64"), actual)
    shipped = table[table["setting"] == "half_life 1"].iloc[0]
    best = best_row(table)
    decay_only = table[table["setting"] != CURRENT_ONLY]
    best_decay = best_row(decay_only)

    print("\n2. FLOOR AND SPREAD")
    print("  baseline: league average only, one number {:.4f} for every play   Brier {:.5f}".format(
        naive, b_global))
    print("  baseline: league rate for the situation, no team at all           Brier {:.5f}".format(b_situation))
    print("  contract setting, half_life 1.0                                   Brier {:.5f}".format(
        shipped["brier"]))
    print("  best setting in the whole sweep, {:<32}          Brier {:.5f}".format(
        best["setting"], best["brier"]))
    print("  best pure-decay setting, {:<40}  Brier {:.5f}".format(
        best_decay["setting"], best_decay["brier"]))
    print("  total spread of the sweep, worst to best: {:.5f} Brier".format(
        table["brier"].max() - table["brier"].min()))
    print("  tuning half_life buys {:+.5f} Brier vs the contract's 1.0 ({:+.3%} relative)".format(
        best_decay["brier"] - shipped["brier"], best_decay["brier"] / shipped["brier"] - 1.0))
    print("  every setting still {} the situation baseline".format(
        "loses to" if table["brier"].min() > b_situation else "beats"))
    print("  rung-1 reach is {} across every decay setting ({} distinct values), because decay moves "
          "rates and never sample_size".format(
              "constant" if decay_only["rung1_reach"].nunique() == 1 else "NOT constant",
              decay_only["rung1_reach"].nunique()))

    labels_all, trans = coach_groups(frames["half_life 1"]["team"], test_season)
    ch = labels_all == "new coach"
    st = labels_all == "same coach"
    print("\n3. REGIME SPLIT on the held-out season")
    print("  {:,} plays by a team with a new head coach for {} ({:.1%}), {:,} same coach ({:.1%}), "
          "{:,} unmatched or in-season".format(
              int(ch.sum()), test_season, ch.mean(), int(st.sum()), st.mean(),
              int((~ch & ~st).sum())))

    grp_rows = []
    for meta in metas:
        frame = frames[meta["label"]]
        grp_rows.append({"setting": meta["label"], "r": meta["r"],
                         "brier_new_coach": group_brier(frame, ch),
                         "brier_same_coach": group_brier(frame, st),
                         "gap": group_brier(frame, ch) - group_brier(frame, st)})
    grp = pd.DataFrame(grp_rows)
    show("4. THE SAME SWEEP, SPLIT BY REGIME", grp)

    b_ch = best_row(grp, "brier_new_coach")
    b_st = best_row(grp, "brier_same_coach")
    ship_ch = grp[grp["setting"] == "half_life 1"].iloc[0]["brier_new_coach"]
    ship_st = grp[grp["setting"] == "half_life 1"].iloc[0]["brier_same_coach"]
    print("\n5. OPTIMAL HALF-LIFE BY REGIME (the question: is it much shorter after a coach change?)")
    print("  new coach   best setting {:<24} Brier {:.5f}  vs {:.5f} at half_life 1.0  ({:+.5f})".format(
        b_ch["setting"], b_ch["brier_new_coach"], ship_ch, b_ch["brier_new_coach"] - ship_ch))
    print("  same coach  best setting {:<24} Brier {:.5f}  vs {:.5f} at half_life 1.0  ({:+.5f})".format(
        b_st["setting"], b_st["brier_same_coach"], ship_st, b_st["brier_same_coach"] - ship_st))
    print("  spread within new coach  {:.5f}   within same coach  {:.5f}".format(
        grp["brier_new_coach"].max() - grp["brier_new_coach"].min(),
        grp["brier_same_coach"].max() - grp["brier_same_coach"].min()))
    ch_decay = grp[grp["setting"] != CURRENT_ONLY]
    st_decay = grp[grp["setting"] != CURRENT_ONLY]
    print("  restricted to pure decay: new coach best {} | same coach best {}".format(
        best_row(ch_decay, "brier_new_coach")["setting"],
        best_row(st_decay, "brier_same_coach")["setting"]))

    _stale_season_test(frames, metas, trans, test_season, train_seasons)
    _honest_split_policy(frames, metas, ch, st, naive, test_season)
    _versus_shrink(frames, table, actual, b_situation, naive)


def _stale_season_test(frames: Dict[str, pd.DataFrame], metas: List[Dict[str, Any]],
                       trans: pd.DataFrame, test_season: int,
                       train_seasons: Sequence[int]) -> None:
    """The one split where a short half-life is supposed to win outright.

    Sections 4 and 5 ask a blunt question: does the coach-change group prefer a
    shorter half-life? But decay can only help when part of the training window
    is stale and part is current. Split the held-out teams by exactly that:

      A  changed for {mid}, not for {test}  -> {old} is under a dead staff, {mid} is
                                               the current staff. Decay targets the
                                               wrong season and keeps the right one.
                                               If the mechanism works anywhere, here.
      B  no change either year              -> both training seasons are the current
                                               staff. Decay can only discard good data.
      C  changed for {test}                 -> both training seasons are stale. Decay
                                               has nothing better to shift weight to,
                                               so it should be near-flat.

    A monotone story would be: A wants short, B wants long, C wants neither.
    """
    old, mid = min(train_seasons), max(train_seasons)
    ch_mid = set(trans[(trans["season"] == mid) & (trans["change_kind"] == "offseason")]["school"])
    ch_test = set(trans[(trans["season"] == test_season) & (trans["change_kind"] == "offseason")]["school"])
    known = (set(trans[trans["season"] == test_season]["school"])
             & set(trans[trans["season"] == mid]["school"]))
    teams = frames["half_life 1"]["team"]
    masks = {
        "A {} stale, {} current".format(old, mid):
            teams.isin(ch_mid - ch_test).to_numpy(),
        "B both seasons current staff":
            teams.isin(known - ch_mid - ch_test).to_numpy(),
        "C both seasons stale":
            teams.isin(ch_test).to_numpy(),
    }
    rows = []
    for label, mask in masks.items():
        if not mask.any():
            continue
        scores = [(group_brier(frames[m["label"]], mask), m["label"], m["r"]) for m in metas
                  if m["label"] != CURRENT_ONLY]
        best_b, best_label, _ = min(scores)
        ship_b = group_brier(frames["half_life 1"], mask)
        short_b = group_brier(frames["half_life 0.05"], mask)
        long_b = group_brier(frames["half_life inf"], mask)
        rows.append({"group": label, "teams": int(teams[mask].nunique()), "plays": int(mask.sum()),
                     "brier_hl_0.05": short_b, "brier_hl_1": ship_b, "brier_hl_inf": long_b,
                     "best_setting": best_label, "brier_at_best": best_b,
                     "gain_vs_contract": best_b - ship_b,
                     "short_minus_long": short_b - long_b})
    show("5b. THE SHARPEST TEST: does decay win where exactly one training season is stale?",
         pd.DataFrame(rows))
    print("  short_minus_long > 0 means forgetting {} HURT that group. The regime story predicts it is "
          "negative for A and positive for B.".format(old))


def _honest_split_policy(frames: Dict[str, pd.DataFrame], metas: List[Dict[str, Any]],
                         ch: np.ndarray, st: np.ndarray, naive: float, test_season: int) -> None:
    """Fit the group half-lives on the first half of the held-out season, score the second.

    The obvious out-of-sample fit (train 2023, score 2024) is degenerate here: a
    one-season training window makes every half-life produce identical weights,
    so there is nothing to fit. Splitting the held-out season by week is the
    honest alternative. The tables never see any of it either way.
    """
    weeks = pd.to_numeric(frames["half_life 1"]["week"]).to_numpy()
    order = np.sort(np.unique(weeks[~np.isnan(weeks)]))
    cut = float(np.median(weeks[~np.isnan(weeks)]))
    fit = weeks <= cut
    hold = ~fit
    print("\n6. HONEST TEST OF A REGIME-AWARE HALF-LIFE")
    print("  a one-season training window makes every half-life identical, so the {} holdout cannot "
          "fit this parameter at all".format(test_season - 1))
    print("  instead: fit on {} weeks {:.0f}-{:.0f} ({:,} plays), score weeks {:.0f}-{:.0f} ({:,} plays)".format(
        test_season, order.min(), cut, int(fit.sum()), cut + 1, order.max(), int(hold.sum())))

    def pick(mask: np.ndarray) -> str:
        scores = [(group_brier(frames[m["label"]], mask), m["label"]) for m in metas]
        return min(scores)[1]

    g_fit = pick(fit)
    ch_fit = pick(fit & ch)
    st_fit = pick(fit & st)
    print("  fitted on the first half: global {} | new coach {} | same coach {}".format(
        g_fit, ch_fit, st_fit))

    actual_h = frames["half_life 1"][hold]["actual"].to_numpy(dtype="float64")

    def preds(label: str) -> np.ndarray:
        return pd.to_numeric(frames[label]["pred"]).to_numpy(dtype="float64")

    ship = backtest.brier(preds("half_life 1")[hold], actual_h)
    tuned = backtest.brier(preds(g_fit)[hold], actual_h)
    aware = np.where(ch, preds(ch_fit), preds(st_fit))
    aware_b = backtest.brier(aware[hold], actual_h)
    b_global_h = backtest.brier(np.full(hold.sum(), naive), actual_h)
    b_sit_h = backtest.brier(
        frames["half_life 1"][hold]["base_situation"].to_numpy(dtype="float64"), actual_h)
    show("6b. SCORED ON THE SECOND HALF OF {}".format(test_season), pd.DataFrame([
        {"policy": "league average only (floor)", "brier": b_global_h, "vs_contract": b_global_h - ship},
        {"policy": "situation rate, no team", "brier": b_sit_h, "vs_contract": b_sit_h - ship},
        {"policy": "contract half_life 1.0", "brier": ship, "vs_contract": 0.0},
        {"policy": "one tuned half-life ({})".format(g_fit), "brier": tuned, "vs_contract": tuned - ship},
        {"policy": "regime-aware ({} / {})".format(ch_fit, st_fit), "brier": aware_b,
         "vs_contract": aware_b - ship},
    ]))
    print("  regime-aware half-life vs one tuned half-life: {:+.5f} Brier ({:+.3%})".format(
        aware_b - tuned, aware_b / tuned - 1.0 if tuned else 0.0))


def _versus_shrink(frames: Dict[str, pd.DataFrame], table: pd.DataFrame,
                   actual: np.ndarray, b_situation: float, naive: float) -> None:
    """Put the two knobs on one scale: forget faster, or trust the team less."""
    shipped = table[table["setting"] == "half_life 1"].iloc[0]
    best_decay = best_row(table[table["setting"] != CURRENT_ONLY])
    best_any = best_row(table)
    frame_ship = frames["half_life 1"]
    frame_best = frames[best_any["setting"]]
    w_ship, b_ship_w = backtest.best_weight(frame_ship)
    w_best, b_best_w = backtest.best_weight(frame_best)
    k_ship, b_ship_k = backtest.best_k(frame_ship)
    k_best, b_best_k = backtest.best_k(frame_best)
    show("7. TWO KNOBS ON ONE SCALE, all on the full held-out season", pd.DataFrame([
        {"policy": "league average only (floor)", "brier": backtest.brier(np.full(len(actual), naive), actual),
         "vs_contract": backtest.brier(np.full(len(actual), naive), actual) - shipped["brier"]},
        {"policy": "situation rate, no team", "brier": b_situation, "vs_contract": b_situation - shipped["brier"]},
        {"policy": "contract: half_life 1.0, team weight 1.0", "brier": shipped["brier"], "vs_contract": 0.0},
        {"policy": "recency knob alone, best decay ({})".format(best_decay["setting"]),
         "brier": best_decay["brier"], "vs_contract": best_decay["brier"] - shipped["brier"]},
        {"policy": "recency knob alone, best any ({})".format(best_any["setting"]),
         "brier": best_any["brier"], "vs_contract": best_any["brier"] - shipped["brier"]},
        {"policy": "shrink knob alone, half_life 1.0 + w={:.2f}".format(w_ship),
         "brier": b_ship_w, "vs_contract": b_ship_w - shipped["brier"]},
        {"policy": "shrink knob alone, half_life 1.0 + n/(n+{:g})".format(k_ship),
         "brier": b_ship_k, "vs_contract": b_ship_k - shipped["brier"]},
        {"policy": "both, {} + w={:.2f}".format(best_any["setting"], w_best),
         "brier": b_best_w, "vs_contract": b_best_w - shipped["brier"]},
        {"policy": "both, {} + n/(n+{:g})".format(best_any["setting"], k_best),
         "brier": b_best_k, "vs_contract": b_best_k - shipped["brier"]},
    ]))
    print("  recency tuning recovers {:.1%} of what the shrink recovers".format(
        (shipped["brier"] - best_decay["brier"]) / (shipped["brier"] - b_ship_w)
        if shipped["brier"] > b_ship_w else float("nan")))
    print("  best shrink weight at half_life 1.0: {:.2f}   at {}: {:.2f}   (if decay already removed the "
          "stale data, this would have risen)".format(w_ship, best_any["setting"], w_best))

    show("7b. CALIBRATION at the contract setting vs the best decay setting",
         pd.concat([backtest.calibration(frame_ship, "pred")[0].assign(setting="half_life 1"),
                    backtest.calibration(frames[best_decay["setting"]], "pred")[0]
                    .assign(setting=best_decay["setting"])])[
             ["setting", "bin", "n", "predicted", "observed", "gap"]].reset_index(drop=True), 4)


# --------------------------------------------------------------------------- #
# NFL

def run_nfl() -> None:
    if not PLAYS_NFL.exists():
        print("\nskip NFL, {} not on disk".format(PLAYS_NFL))
        return
    df = schema.read_plays(PLAYS_NFL)
    seasons = sorted(int(s) for s in df["season"].dropna().unique())
    train, test, label = backtest.temporal_split(df)
    train_seasons = sorted(int(s) for s in train["season"].dropna().unique())

    print("\n" + "=" * 104)
    print("RECENCY SWEEP / NFL   file={}".format(PLAYS_NFL.name))
    print("  seasons present: {}".format(seasons))
    print("  split: {}".format(label))

    naive = backtest.global_rate(train)
    rows = []
    for cfg in settings(train_seasons):
        scored, _ = score_setting(train, test, naive, cfg["half_life"], cfg["seasons"])
        scored = scored[pd.to_numeric(scored["pred"]).notna()].reset_index(drop=True)
        m = metrics(scored, naive)
        rows.append({"setting": cfg["label"], "n": m["n"], "brier": m["brier"], "ece": m["ece"],
                     "accuracy": m["accuracy"], "rung1_reach": m["rung1_reach"]})
    table = pd.DataFrame(rows)
    show("N1. HALF-LIFE SWEEP on the NFL week holdout", table, 8)
    spread = table["brier"].max() - table["brier"].min()
    print("  distinct Brier values across the whole sweep: {}".format(table["brier"].nunique()))
    print("  spread: {:.10f}".format(spread))
    print("  the training frame carries {} season(s), so 0.5**((max_season - season)/half_life) is 1.0 "
          "for every row at every half-life. The parameter is unreachable, not merely weak.".format(
              len(train_seasons)))
    print("  a within-season week decay would be a new mechanism, not a tuning of this one, so it is "
          "out of scope for this test and untestable on one season of NFL data anyway.")


if __name__ == "__main__":
    run_cfb()
    run_nfl()

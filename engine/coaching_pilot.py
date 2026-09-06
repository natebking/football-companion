"""Chronological NFL context and actual-play-caller transfer pilot.

Run: .venv/bin/python engine/coaching_pilot.py
Writes private data/coaching-pilot/ plus docs/coaching-pilot-audit.json. Never
changes production tables. Uses the existing nflverse ingester and estimator.

Protocol: 2018-25 history; 2023, 2024 and 2025 outer test seasons. In each fold,
choose context/identity shrinkage on the preceding season only, then refit on
all earlier seasons. Identity shrinkage is tuned on all NFL TEAMS, not the
one pilot coach. Apply that same strength to team, current-tenure and career
residuals. This tests transfer without tuning to Denver's held-out outcomes.

The context table adds pre-snap score band and clock phase to the current
situation bucket. An identity's down/distance residual is its observed pass
rate minus the contextual expectation in training, shrunk toward zero. The
same calculation is used for teams and callers. It describes association,
not a coach's causal effect, and does not observe formations or coverage.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import backtest
import buckets
import ingest_nfl
import schema
import tendency

ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = Path(__file__).with_name("coaching_pilot_sources.json")
SEASONS = list(range(2018, 2026))
HOLDOUTS = [2023, 2024, 2025]
CONTEXT_K = [10., 30., 100., 300., 1000.]
IDENTITY_K = [30., 60., 200., 600., 2000., math.inf]
HALF_LIFE = 2.0  # fixed before evaluation, not optimized on the holdouts
BOOTSTRAP_REPS = 2000


def caller_labels(frame, catalog):
    """No head-coach substitution; verified exceptions clear the caller label."""
    caller = pd.Series([None] * len(frame), index=frame.index, dtype=object)
    tenure = pd.Series([None] * len(frame), index=frame.index, dtype=object)
    for assignment in catalog["assignments"]:
        mask = frame.offense.eq(assignment["team"]) & frame.season.isin(assignment["seasons"])
        if caller[mask].notna().any():
            raise ValueError("overlapping caller assignments")
        caller.loc[mask] = assignment["callerId"]
        tenure.loc[mask] = assignment["tenureId"]
    for exception in catalog["exceptions"]:
        if exception.get("excludeFromCallerTraining"):
            mask = frame.game_id.eq(exception["gameId"]) & frame.offense.eq(exception["team"])
            caller.loc[mask] = None
            tenure.loc[mask] = None
    return caller, tenure


def prepare(frame, catalog):
    """Keep the production run/pass target; unknown required context is excluded."""
    d = tendency.eligible(frame).copy()
    d["bucket"] = buckets.bucket_series(d.down, d.distance, d.yards_to_goal)
    needed = ["bucket", "score_diff", "period", "clock_seconds"]
    d = d.dropna(subset=needed).reset_index(drop=True)
    d["band"] = buckets.distance_band_series(d.distance)
    d["identity_bucket"] = "d" + d.down.astype(str) + "_" + d.band.astype(str)
    score = d.score_diff.to_numpy(dtype=float)
    d["score_band"] = np.select([score <= -9, score < 0, score == 0, score <= 8],
                                 ["behind_9plus", "behind_1to8", "tied", "ahead_1to8"],
                                 default="ahead_9plus")
    q = d.period.to_numpy(dtype=int)
    clock = d.clock_seconds.to_numpy(dtype=int)
    d["phase"] = np.select([q > 4, (q == 4) & (clock <= 120),
                            (q == 4) & (clock <= 300), q == 4,
                            (q == 2) & (clock <= 120)],
                           ["overtime", "last_2min", "last_5min", "fourth", "half_2min"],
                           default="ordinary")
    d["context"] = d.bucket + "|" + d.score_band + "|" + d.phase
    d["caller"], d["tenure"] = caller_labels(d, catalog)
    d["actual"] = d.is_pass.astype(float)
    return d


def weighted(frame, reference):
    if frame.empty:
        raise ValueError("empty training frame")
    if int(frame.season.max()) > reference:
        raise ValueError("future training rows")
    return np.power(.5, (reference - frame.season.to_numpy(dtype=int)) / HALF_LIFE)


def aggregate(frame, key, reference, values):
    w = weighted(frame, reference)
    d = pd.DataFrame({"key": frame[key].to_numpy(), "n": w, "total": w * np.asarray(values)})
    return d.groupby("key").agg(n=("n", "sum"), total=("total", "sum"))


def fit_context(train, k, context_enabled=True):
    reference = int(train.season.max())
    w = weighted(train, reference)
    overall = float(np.average(train.actual, weights=w))
    league = aggregate(train, "bucket", reference, train.actual)
    # Production prior strength, with no dependence on any outer test outcome.
    league["rate"] = (league.total + tendency.SHRINK_K * overall) / (league.n + tendency.SHRINK_K)
    feature = "context" if context_enabled else "bucket"
    context = aggregate(train, feature, reference, train.actual)
    return {"k": k, "overall": overall, "league": league.rate, "context": context,
            "reference": reference, "feature": feature}


def predict_context(model, frame):
    prior = frame.bucket.map(model["league"]).fillna(model["overall"]).to_numpy(dtype=float)
    stats = model["context"].reindex(frame[model["feature"]])
    n = stats.n.fillna(0).to_numpy()
    total = stats.total.fillna(0).to_numpy()
    return (total + model["k"] * prior) / (n + model["k"])


def fit_identity(train, context_model, identity, k):
    valid = train[identity].notna()
    d = train.loc[valid].copy()
    if d.empty or not math.isfinite(k):
        return {"k": k, "offset": pd.Series(dtype=float), "rows": 0}
    d["identity_key"] = d[identity] + "|" + d.identity_bucket
    residual = d.actual.to_numpy() - predict_context(context_model, d)
    stats = aggregate(d, "identity_key", context_model["reference"], residual)
    return {"k": k, "offset": stats.total / (stats.n + k), "rows": len(d)}


def predict_identity(context_model, identity_model, frame, identity):
    base = predict_context(context_model, frame)
    key = frame[identity].fillna("") + "|" + frame.identity_bucket
    offset = key.map(identity_model["offset"]).fillna(0).to_numpy(dtype=float)
    return np.clip(base + offset, .001, .999)


def brier(actual, pred):
    return float(np.mean((np.asarray(actual) - np.asarray(pred)) ** 2))


def tune(train, validation):
    if int(train.season.max()) >= int(validation.season.min()):
        raise ValueError("training and validation seasons overlap")
    context_curve = []
    for k in CONTEXT_K:
        model = fit_context(train, k)
        context_curve.append({"k": k, "brier": brier(validation.actual, predict_context(model, validation))})
    context_k = min(context_curve, key=lambda row: (row["brier"], -row["k"]))["k"]
    model = fit_context(train, context_k)
    identity_curve = []
    for k in IDENTITY_K:
        im = fit_identity(train, model, "offense", k)
        p = predict_identity(model, im, validation, "offense")
        identity_curve.append({"k": k, "brier": brier(validation.actual, p)})
    identity_k = min(identity_curve, key=lambda row: (row["brier"], -row["k"]))["k"]
    return context_k, identity_k, context_curve, identity_curve


def tune_situation(train, validation):
    """Matched context ablation, with its own prior strength fit before test."""
    curve = []
    for k in CONTEXT_K:
        model = fit_context(train, k, context_enabled=False)
        curve.append({"k": k, "brier": brier(validation.actual, predict_context(model, validation))})
    return min(curve, key=lambda row: (row["brier"], -row["k"]))["k"], curve


def chronological_split(frame, year):
    train = frame[frame.season < year - 1]
    validation = frame[frame.season == year - 1]
    refit = frame[frame.season < year]
    test = frame[frame.season == year]
    if any(x.empty for x in (train, validation, refit, test)):
        raise ValueError("missing required chronological split")
    if not (int(train.season.max()) < int(validation.season.min()) < int(test.season.min())):
        raise ValueError("invalid chronology")
    if set(refit.game_id) & set(test.game_id):
        raise ValueError("games overlap training and test")
    return train, validation, refit, test


def production_predictions(train, test, recent_only=False):
    """The current estimator, called directly, on identical held-out plays."""
    seasons = sorted(int(s) for s in train.season.unique())
    if recent_only:
        seasons = seasons[-3:]
    tables = tendency.build(train[schema.COLUMN_NAMES], seasons=seasons)
    # Query each observed combination once. This preserves original test order.
    keys = list(zip(test.offense, test.down, test.distance, test.yards_to_goal))
    cache = {key: tendency.query(tables, *key)["pass_rate"] for key in set(keys)}
    return np.array([cache[key] for key in keys])


def metrics(frame, column):
    p, y = frame[column].to_numpy(), frame.actual.to_numpy()
    calibration = []
    for lo in np.arange(0, 1, .1):
        selected = (p >= lo) & (p < lo + .1 if lo < .9 else p <= 1)
        if selected.any():
            calibration.append({"from": round(float(lo), 1), "n": int(selected.sum()),
                                "predicted": float(p[selected].mean()), "observed": float(y[selected].mean())})
    ece = sum(row["n"] * abs(row["predicted"] - row["observed"]) for row in calibration) / len(frame)
    return {"plays": len(frame), "games": frame.game_id.nunique(), "brier": brier(y, p),
            "accuracy": float(np.mean((p >= .5) == y)), "ece": ece, "calibration": calibration}


def paired_bootstrap(frame, candidate, baseline, cluster="game_id"):
    """Resample whole games (pilot) or teams (league), paired across models."""
    loss = (frame[candidate] - frame.actual) ** 2 - (frame[baseline] - frame.actual) ** 2
    stats = pd.DataFrame({"group": frame[cluster], "loss": loss, "n": 1}).groupby("group").sum()
    rng = np.random.default_rng(731)
    sample = rng.integers(0, len(stats), size=(BOOTSTRAP_REPS, len(stats)))
    estimates = stats.loss.to_numpy()[sample].sum(axis=1) / stats.n.to_numpy()[sample].sum(axis=1)
    interval = [float(v) for v in np.quantile(estimates, [.025, .975])]
    return {"difference": float(loss.mean()), "interval95": interval, "cluster": cluster,
            "clusters": len(stats), "replicates": BOOTSTRAP_REPS,
            "verdict": "better" if interval[1] < 0 else "worse" if interval[0] > 0 else "not established"}


def run(frame, catalog, output_dir):
    d = prepare(frame, catalog)
    if d.duplicated(["game_id", "play_id"]).any():
        raise ValueError("duplicate play identities")
    folds, predictions = [], []
    for year in HOLDOUTS:
        inner, validation, train, test = chronological_split(d, year)
        ck, ik, cc, ic = tune(inner, validation)
        sk, sc = tune_situation(inner, validation)
        model = fit_context(train, ck)
        team_model = fit_identity(train, model, "offense", ik)
        tenure_model = fit_identity(train, model, "tenure", ik)
        career_model = fit_identity(train, model, "caller", ik)
        p = test[["season", "game_id", "play_id", "offense", "caller", "actual"]].copy()
        p["production_last3"] = production_predictions(train, test, recent_only=True)
        p["production_long"] = production_predictions(train, test)
        p["situation_control"] = predict_context(fit_context(train, sk, context_enabled=False), test)
        p["context"] = predict_context(model, test)
        p["context_team"] = predict_identity(model, team_model, test, "offense")
        known = test.caller.notna().to_numpy()
        p["context_tenure"] = np.where(known, predict_identity(model, tenure_model, test, "tenure"), p.context_team)
        p["context_career"] = np.where(known, predict_identity(model, career_model, test, "caller"), p.context_team)
        p["context_career_blend"] = (p.context_career + p.context_team) / 2  # fixed cautious transfer control
        columns = list(p.columns[6:])
        pilot = p[p.caller.notna()]
        folds.append({"holdout": year, "innerTrainSeasons": sorted(int(s) for s in inner.season.unique()),
                      "validationSeason": year - 1, "refitThroughSeason": year - 1,
                      "contextK": ck, "identityK": ik, "contextValidationCurve": cc,
                      "situationControlK": sk, "situationValidationCurve": sc,
                      "identityValidationCurve": ic, "league": {c: metrics(p, c) for c in columns},
                      "pilot": {c: metrics(pilot, c) for c in columns},
                      "pilotTraining": {"careerPlays": int(train.caller.eq("sean_payton").sum()),
                                        "currentTenurePlays": int(train.tenure.eq("sean_payton_DEN").sum())}})
        predictions.append(p)
        print("{}: context k={} identity k={} | NFL {:.5f} -> {:.5f}; DEN team {:.5f} career {:.5f}".format(
            year, ck, ik, brier(p.actual, p.production_last3), brier(p.actual, p.context_team),
            brier(pilot.actual, pilot.context_team), brier(pilot.actual, pilot.context_career)), flush=True)
    p = pd.concat(predictions, ignore_index=True)
    pilot = p[p.caller.notna()]
    output_dir.mkdir(parents=True, exist_ok=True)
    p.to_parquet(output_dir / "predictions.parquet", index=False)
    columns = list(p.columns[6:])
    report = {
        "schemaVersion": 1, "generated": "2026-09-05", "status": "research_only",
        "data": {"source": "nflverse play-by-play", "url": "https://github.com/nflverse/nflverse-data/releases/tag/pbp",
                 "seasons": SEASONS, "unifiedRows": len(frame), "eligibleWithContext": len(d),
                 "excludedMissingContext": len(tendency.eligible(frame)) - len(d),
                 "uniqueGames": frame.game_id.nunique(), "duplicateEligiblePlays": 0,
                 "callerLabelledPlays": int(d.caller.notna().sum()),
                 "callerTrainingExceptionPlays": int((d.game_id.eq("2021_15_NO_TB") & d.offense.eq("NO")).sum()),
                 "mappingSha256": hashlib.sha256(SOURCE_PATH.read_bytes()).hexdigest()},
        "protocol": {"holdouts": HOLDOUTS, "halfLifeSeasons": HALF_LIFE,
                     "contextFeatures": ["down", "distance band", "field zone", "score band", "clock phase"],
                     "identityResidualFeatures": ["identity", "down", "distance band"],
                     "identityKFitOn": "all NFL team identities in preceding validation season, never held-out caller outcomes",
                     "productionComparison": "current tendency.py, both prior three seasons and all prior available seasons",
                     "target": "recorded pass vs run under current production classification; QB scrambles are runs",
                     "blendWeight": .5, "outcomeAccess": "all fitting seasons precede each outer test season"},
        "folds": folds, "pooledLeague": {c: metrics(p, c) for c in columns},
        "pooledPilot": {c: metrics(pilot, c) for c in columns},
        "comparisons": {
            "contextTeamVsProduction": paired_bootstrap(p, "context_team", "production_last3", "offense"),
            "contextVsProduction": paired_bootstrap(p, "context", "production_last3", "offense"),
            "contextVsMatchedSituation": paired_bootstrap(p, "context", "situation_control", "offense"),
            "longHistoryVsRecent": paired_bootstrap(p, "production_long", "production_last3", "offense"),
            "pilotCareerVsTeam": paired_bootstrap(pilot, "context_career", "context_team"),
            "pilotTenureVsTeam": paired_bootstrap(pilot, "context_tenure", "context_team"),
            "pilotBlendVsTeam": paired_bootstrap(pilot, "context_career_blend", "context_team"),
            "pilotCareerVsContext": paired_bootstrap(pilot, "context_career", "context")},
        "limits": catalog["limitations"] + [
            "One coach and one transfer: game bootstrap intervals describe these Denver games, not coach-to-coach generalization.",
            "Quarterbacks, injuries, opponent, roster quality, personnel and formation are not controlled. Associations are not causal coaching effects.",
            "This uses finalized play-by-play and reconstructs pre-snap fields, not the live payloads that were actually available before kickoff.",
            "A context-model result is an offline finding, not authorization to ship revised live probabilities or claim a learning effect.",
            "The fixed 50/50 transfer blend is exploratory; several comparisons are reported and no multiple-testing correction is applied."]}
    report["data"]["inputs"] = [{"file": ingest_nfl.raw_path(year).name,
                                  "bytes": ingest_nfl.raw_path(year).stat().st_size,
                                  "sha256": hashlib.sha256(ingest_nfl.raw_path(year).read_bytes()).hexdigest()}
                                 for year in SEASONS]
    return report


def serializable(value):
    if isinstance(value, dict):
        return {key: serializable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [serializable(item) for item in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (float, np.floating)) and not math.isfinite(value):
        return "infinity"
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "docs" / "coaching-pilot-audit.json")
    args = parser.parse_args()
    catalog = json.loads(SOURCE_PATH.read_text())
    output_dir = ROOT / "data" / "coaching-pilot"
    path = output_dir / "plays_nfl_2018_2025.parquet"
    if path.exists():
        frame = schema.read_plays(path)
    else:
        frame = ingest_nfl.ingest(SEASONS)
        schema.write_plays(frame, path)
    report = serializable(run(frame, catalog, output_dir))
    args.out.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print("wrote {}".format(args.out))


if __name__ == "__main__":
    main()

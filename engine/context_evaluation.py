"""Fixed chronological score/clock evaluation; never changes production tables.

Protocol: docs/CONTEXT-EVALUATION-PROTOCOL-2026-09-06.md.
Run: .venv/bin/python engine/context_evaluation.py
Dependency: uv pip install --python .venv/bin/python -r engine/requirements-context.txt
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np
import pandas as pd
from scipy.special import expit, logit
from sklearn.linear_model import LogisticRegression

import coaching_pilot as pilot
import schema
import tendency
import ingest_cfb

ROOT = Path(__file__).resolve().parents[1]
PATHS = {"nfl": ROOT / "data/coaching-pilot/plays_nfl_2018_2025.parquet",
         "cfb": ROOT / "data/plays_cfb.parquet"}
CALIBRATION_C = 1_000_000


def split(frame, year=2025):
    """CFBD's ingester puts bowl week 1 after regular weeks, at week 16."""
    before = frame[frame.season < year - 1]
    tune = frame[(frame.season == year - 1) & (frame.week <= 9)]
    calibration = frame[(frame.season == year - 1) & (frame.week > 9)]
    test = frame[frame.season == year]
    parts = [before, tune, calibration, test]
    if any(p.empty for p in parts):
        raise ValueError("Missing chronological partition")
    for i, p in enumerate(parts):
        for other in parts[i + 1:]:
            if set(p.game_id) & set(other.game_id):
                raise ValueError("A game crosses chronological partitions")
    return parts


def fit_calibration(prediction, actual):
    x = logit(np.clip(prediction, .001, .999)).reshape(-1, 1)
    model = LogisticRegression(C=CALIBRATION_C, solver="lbfgs", max_iter=1000, tol=1e-10)
    model.fit(x, actual)
    return {"slope": float(model.coef_[0, 0]), "intercept": float(model.intercept_[0])}


def calibrated(prediction, calibration):
    return expit(calibration["slope"] * logit(np.clip(prediction, .001, .999)) + calibration["intercept"])


def fit(frame, ck, ik):
    model = pilot.fit_context(frame, ck)
    return model, pilot.fit_identity(frame, model, "offense", ik)


def predict(models, frame):
    return pilot.predict_identity(*models, frame, "offense")


def export_model(models, calibration, train, league):
    model, identity = models
    context_n = train.groupby("context").size()
    context_games = train.groupby("context").game_id.nunique()
    identity_n = train.groupby(train.offense + "|" + train.identity_bucket).size()
    return {"schemaVersion": 1, "version": "context-1-research", "league": league,
            "status": "research_only", "throughSeason": int(train.season.max()),
            "seasons": sorted(int(y) for y in train.season.unique()),
            "target": "recorded pass (including sack) versus rush (including scramble); excludes kneels, penalties and kicking plays",
            "k": model["k"], "overall": model["overall"], "leagueRates": model["league"].to_dict(),
            "contexts": {key: {"weightedN": float(row.n), "weightedPasses": float(row.total),
                                 "n": int(context_n[key]), "games": int(context_games[key])}
                         for key, row in model["context"].iterrows()},
            "teams": {key: {"offset": float(offset), "n": int(identity_n[key])}
                      for key, offset in identity["offset"].items()},
            "calibration": calibration}


def client_parity(export, test, expected):
    keys = ["game_id", "offense", "down", "distance", "yards_to_goal", "period", "clock_seconds", "score_diff"]
    probes = test[keys].copy()
    probes["expected"] = expected
    probes = probes.drop_duplicates(keys[1:])
    rows = [{"league": export["league"], "team": row.offense, "down": int(row.down),
             "distance": int(row.distance), "yardsToGoal": int(row.yards_to_goal), "period": int(row.period),
             "clockSeconds": int(row.clock_seconds), "scoreDiff": int(row.score_diff)}
            for row in probes.itertuples()]
    script = "const fs=require('fs'),m=require('./web/context-model.js'),d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(d.rows.map(s=>m.predict(d.model,s)?.probability??null)));"
    result = subprocess.run(["node", "-e", script], cwd=ROOT,
                            input=json.dumps({"model": export, "rows": rows}), text=True, capture_output=True, check=True)
    actual = np.asarray(json.loads(result.stdout), dtype=float)
    error = np.max(np.abs(actual - probes.expected.to_numpy()))
    if not np.isfinite(error) or error > 1e-12:
        raise ValueError(f"Client parity failed: {error}")
    return {"uniqueInputs": len(rows), "maxAbsoluteError": float(error), "passed": True}


def run(league, frame):
    # Preserve an audit of legacy parquet clocks; do not silently assume they
    # were recorded at the snap. Use the same parser as future CFB ingestion.
    frame = frame.copy()
    label_changes = 0
    if league == "cfb":
        categories = pd.Series([ingest_cfb.classify(t, text if isinstance(text, str) else None)[0]
                                for t, text in zip(frame.play_type_raw, frame.play_text)], index=frame.index)
        label_changes = int(((frame.is_pass != categories.eq('pass')) | (frame.is_rush != categories.eq('rush')) |
                             (frame.is_penalty_only != categories.eq('penalty'))).sum())
        frame['is_pass'], frame['is_rush'] = categories.eq('pass'), categories.eq('rush')
        frame['is_special'], frame['is_penalty_only'] = categories.eq('special'), categories.eq('penalty')
    reported = frame.play_text.map(ingest_cfb.text_clock)
    eligible = tendency.eligible(frame).index
    old = frame.clock_seconds.copy()
    changed = reported.notna() & old.ne(reported)
    phase_change = changed & (((frame.period == 4) & ((old.le(120) != reported.le(120)) | (old.le(300) != reported.le(300)))) |
                              ((frame.period == 2) & (old.le(120) != reported.le(120))))
    clock_audit = {"eligibleWithExplicitSnapClock": int(reported.loc[eligible].notna().sum()),
                   "eligibleClocksDiffer": int(changed.loc[eligible].sum()),
                   "eligiblePhaseChanges": int(phase_change.loc[eligible].sum()),
                   "fallback": "Structured source clock when the report has no explicit leading snap time; exact snap semantics are not independently verified."}
    if league == "cfb":
        frame.loc[reported.notna(), "clock_seconds"] = reported[reported.notna()].astype("Int16")
    d = pilot.prepare(frame, {"assignments": [], "exceptions": []})
    # CFBD has a few zero-distance goal-line records. They cannot describe the
    # positive-distance live situation contract, so neither model is scored on them.
    d = d[d.distance >= 1].copy()
    if d.duplicated(["game_id", "play_id"]).any():
        raise ValueError("Duplicate play identity")
    before, tuning, calibration_rows, test = split(d)
    ck, ik, cc, ic = pilot.tune(before, tuning)
    calibration_base = pd.concat([before, tuning], ignore_index=True)
    cal = fit_calibration(predict(fit(calibration_base, ck, ik), calibration_rows), calibration_rows.actual)
    train = pd.concat([calibration_base, calibration_rows], ignore_index=True)
    models = fit(train, ck, ik)
    p = test[["game_id", "play_id", "season", "offense", "phase", "score_band", "actual"]].copy()
    p["production"] = pilot.production_predictions(train, test, recent_only=True)
    p["context_team"] = predict(models, test)
    p["calibrated"] = calibrated(p.context_team, cal)
    scores = {c: pilot.metrics(p, c) for c in ["production", "context_team", "calibrated"]}
    comparison = pilot.paired_bootstrap(p, "calibrated", "production")
    groups = []
    for (phase, band), group in p.groupby(["phase", "score_band"]):
        groups.append({"phase": phase, "scoreBand": band, "plays": len(group),
                       "baseline": pilot.brier(group.actual, group.production),
                       "candidate": pilot.brier(group.actual, group.calibrated)})
    gates = {"positiveCalibrationSlope": cal["slope"] > 0,
             "pairedImprovement": comparison["interval95"][1] < 0,
             "calibrationECE": scores["calibrated"]["ece"] <= .025,
             "supportedCalibrationBins": all(abs(b["predicted"] - b["observed"]) <= .05
                                             for b in scores["calibrated"]["calibration"] if b["n"] >= 500),
             "contextRegressions": all(g["candidate"] - g["baseline"] <= .01 for g in groups if g["plays"] >= 200)}
    exported = export_model(models, cal, train, league)
    parity = client_parity(exported, test, p.calibrated.to_numpy())
    report = {"league": league, "status": "research_only", "year": 2025,
              "inputRows": len(frame), "eligibleRows": len(tendency.eligible(frame)),
              "knownContextRows": len(d), "excludedContext": len(tendency.eligible(frame)) - len(d),
              "clockAudit": clock_audit,
              "sourceLabelCorrections": label_changes,
              "partitions": {key: {"plays": len(value), "games": value.game_id.nunique()}
                             for key, value in zip(["before2024", "tuning2024Weeks1to9", "calibration2024AfterWeek9", "test2025"],
                                                   [before, tuning, calibration_rows, test])},
              "contextK": ck, "identityK": ik if np.isfinite(ik) else None,
              "tuningCurves": {"context": cc, "team": [dict(row, k=row["k"] if np.isfinite(row["k"]) else None) for row in ic]},
              "calibration": cal, "scores": scores, "pairedComparison": comparison,
              "subgroups": groups, "researchGates": gates, "allResearchGatesPass": all(gates.values()),
              "clientParity": parity, "liveReplacementApproved": False}
    return report, exported, p


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--league", choices=["cfb", "nfl", "both"], default="both")
    args = parser.parse_args()
    out = ROOT / "data/context-evaluation"
    out.mkdir(parents=True, exist_ok=True)
    results = []
    for league in PATHS if args.league == "both" else [args.league]:
        path = PATHS[league]
        result, exported, predictions = run(league, schema.read_plays(path))
        result["inputSha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        predictions.to_parquet(out / f"predictions-{league}-2025.parquet", index=False)
        (out / f"context-{league}-2025.json").write_text(json.dumps(exported, allow_nan=False, separators=(",", ":")))
        results.append(result)
        print(json.dumps({"league": league, "scores": {k: {m: v[m] for m in ["plays", "brier", "accuracy", "ece"]} for k, v in result["scores"].items()},
                          "gates": result["researchGates"], "parity": result["clientParity"]}), flush=True)
    report = {"schemaVersion": 1, "protocol": "CONTEXT-EVALUATION-PROTOCOL-2026-09-06.md", "results": results}
    (ROOT / "docs/context-evaluation-audit.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()

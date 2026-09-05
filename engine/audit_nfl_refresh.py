"""Reproduce the NFL history refresh checks without changing the estimator.

Run after ingest/export:
  .venv/bin/python engine/audit_nfl_refresh.py --out docs/nfl-refresh-audit.json

All model choices are frozen at the repository defaults. The validation fit is
reported to check those defaults; the final season is never used to select k.
The audit raises on duplicate grain, missing features, leakage or export drift.
Statistical ties are reported as ties.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

import backtest
import buckets
import calibrate
import export_tables
import schema
import tendency

ROOT = Path(__file__).resolve().parents[1]


def audit():
    frame = schema.read_plays(ROOT / "data/plays_nfl.parquet")
    eligible = tendency.eligible(frame)
    assert not frame.duplicated(["game_id", "play_id"]).any(), "Duplicate play IDs"
    assert not frame.duplicated(["game_id", "play_index"]).any(), "Duplicate play order"
    features = ["offense", "defense", "down", "distance", "yards_to_goal", "yards_gained", "score_diff"]
    assert not eligible[features].isna().any().any(), "Missing eligible features"
    keys = buckets.bucket_series(eligible.down, eligible.distance, eligible.yards_to_goal)
    assert not keys.isna().any(), "Unbucketable eligible plays"
    profile = []
    for year, group in frame.groupby("season"):
        plays = tendency.eligible(group)
        profile.append({"season": int(year), "rows": len(group), "eligible": len(plays),
                        "games": int(group.game_id.nunique()), "teams": int(group.offense.nunique()),
                        "passRate": float(plays.is_pass.mean())})

    train, holdout, split = backtest.temporal_split(frame)
    inner, validation, inner_label = calibrate.tail_split(train)
    assert set(train.game_id).isdisjoint(set(holdout.game_id)), "Leaked game IDs"
    assert calibrate._stamp(validation).max() < calibrate._stamp(holdout).min(), "Leaked weeks"
    validation_scores = calibrate.evaluate(inner, validation, 1.0)
    curve = calibrate.sweep(validation_scores, "base_situation", calibrate.ALL_K)
    best = min(curve, key=curve.get)
    plateau = [k for k in calibrate.ALL_K if np.isfinite(k) and curve[k] <= curve[best] + .0002]

    scored = backtest.predict(tendency.build(train), holdout, backtest.global_rate(train))
    actual = scored.actual.to_numpy(dtype="float64")
    predicted = scored.pred.to_numpy(dtype="float64")
    base = scored.base_situation.to_numpy(dtype="float64")
    delta, low, high = calibrate.cluster_bootstrap(scored, predicted, base)
    validation_result = {
        "outerSplit": split, "innerSplit": inner_label, "holdoutPlays": len(scored),
        "shippedK": tendency.SHRINK_K, "validationBestK": best,
        "validationPlateau": [min(plateau), max(plateau)],
        "brier": backtest.brier(predicted, actual), "baselineBrier": backtest.brier(base, actual),
        "accuracy": backtest.accuracy(predicted, actual), "baselineAccuracy": backtest.accuracy(base, actual),
        "ece": backtest.calibration(scored)[1], "baselineEce": backtest.calibration(scored, "base_situation")[1],
        "pairedBrierDifference": delta, "teamBootstrap95Interval": [low, high],
        "bootstrapReplicates": calibrate.BOOTSTRAP_REPS,
        "verdict": "beats baseline" if high < 0 else "loses to baseline" if low > 0 else "statistical tie",
    }

    tables = tendency.build(frame)
    path = ROOT / "web/tendency-nfl.json"
    payload = json.loads(path.read_text())
    fresh, export_report = export_tables.export(tables, generated=payload["generated"])
    assert fresh == payload, "Shipped table does not match current source data"
    assert export_report["gzip"] <= export_report["budget"], "Shipped table exceeds size budget"
    counts = eligible.assign(key=keys).groupby(["offense", "key"]).size()
    mismatches = 0
    for (team, key), count in counts.items():
        wanted = tendency.query(tables, team, *export_tables.probe(key))
        got = export_tables.lookup(payload, team, *export_tables.probe(key))
        if got["rung"] in export_tables.SHIP_RUNGS:
            mismatches += int(count) * int(any([
                got["rung"] != wanted["rung"], got["team"] != wanted["team"],
                got["sample_size"] != wanted["sample_size"], got["confidence"] != wanted["confidence"],
                got["pass_rate"] != export_tables._r(wanted["pass_rate"]),
                got["shrink_weight"] != wanted["shrink_weight"],
            ]))
        else:
            assert got["team"] is None, "League fallback claimed a team"
    assert mismatches == 0, "Client reads disagree with engine"
    return {
        "grain": "one NFL play per game_id + play_id", "rows": len(frame), "eligible": len(eligible),
        "duplicatePlayIds": 0, "duplicateOrder": 0, "eligibleMissingFeatures": 0, "unbucketable": 0,
        "seasons": profile, "validation": validation_result,
        "export": {"seasons": payload["seasons"], "generated": payload["generated"],
                   "bytes": export_report["bytes"], "gzipBytes": export_report["gzip"],
                   "teamEntries": export_report["team_entries"], "attributableEntries": export_report["attributable_entries"],
                   "clientMismatchedPlays": mismatches,
                   "sha256": hashlib.sha256(path.read_bytes()).hexdigest()},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    result = audit()
    text = json.dumps(result, indent=2) + "\n"
    if args.out:
        args.out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()

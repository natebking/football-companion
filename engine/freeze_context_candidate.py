"""Freeze evaluated 2026 research candidates and baselines, never web assets."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import numpy as np

import context_evaluation as evaluation
import coaching_pilot as pilot
import schema
import source_context

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def refit(frame, league, settings, through=2025):
    # Reject, rather than merely filter, future input so accidental contamination
    # is visible. Alignment uses cached same-identity source records.
    if frame.season.max() > through:
        raise ValueError('Training input contains a future season')
    aligned, alignment = source_context.align(frame, league)
    d = pilot.prepare(aligned, {'assignments': [], 'exceptions': []})
    d = d[d.distance >= 1].copy()
    if d.season.max() != through or d.duplicated(['game_id', 'play_id']).any():
        raise ValueError('Missing final training season or duplicate play identity')
    ck = settings['contextK']
    ik = settings['identityK'] if settings['identityK'] is not None else np.inf
    cal = settings['calibration']
    if not settings['allResearchGatesPass'] or cal['slope'] <= 0:
        raise ValueError('Candidate did not pass its declared research checks')
    models = evaluation.fit(d, ck, ik)
    exported = evaluation.export_model(models, cal, d, league)
    expected = evaluation.calibrated(evaluation.predict(models, d), cal)
    parity = evaluation.client_parity(exported, d, expected)
    return exported, {'trainingPlays': len(d), 'trainingGames': int(d.game_id.nunique()),
                      'contextK': ck, 'identityK': settings['identityK'], 'calibration': cal,
                      'alignment': alignment, 'clientParity': parity}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', required=True, type=Path)
    args = p.parse_args()
    # A failed build may leave an incomplete directory; it is never a valid freeze
    # until manifest.json is written last. A second run needs a new directory.
    args.out.mkdir(parents=True, exist_ok=False)
    audit_path = ROOT / 'docs/context-evaluation-audit.json'
    settings = {r['league']: r for r in json.loads(audit_path.read_text())['results']}
    manifest = {'schemaVersion': 1, 'status': 'research_only', 'targetSeason': 2026,
                'protocol': 'FORECAST-REPLAY-PROTOCOL-2026-09-06.md', 'evaluationSha256': sha(audit_path), 'leagues': {}}
    for league, source in evaluation.PATHS.items():
        if sha(source) != settings[league]['inputSha256']:
            raise ValueError('Training source differs from evaluated input: ' + league)
        model, result = refit(schema.read_plays(source), league, settings[league])
        path = args.out / f'context-{league}.json'
        path.write_text(json.dumps(model, allow_nan=False, separators=(',', ':')))
        baseline = ROOT / f'web/tendency-{league}.json'
        baseline_path = args.out / f'baseline-{league}.json'
        baseline_path.write_bytes(baseline.read_bytes())
        result.update({'candidateFile': path.name, 'candidateSha256': sha(path),
                       'baselineFile': baseline_path.name, 'baselineSha256': sha(baseline_path),
                       'inputFile': str(source.relative_to(ROOT)), 'inputSha256': sha(source)})
        manifest['leagues'][league] = result
        print(league, result['trainingPlays'], 'plays;', result['clientParity'], flush=True)
    code = ['engine/freeze_context_candidate.py', 'engine/context_evaluation.py', 'engine/coaching_pilot.py',
            'engine/source_context.py', 'engine/ingest_cfb.py', 'engine/tendency.py', 'engine/buckets.py',
            'engine/schema.py', 'web/context-model.js', 'web/game-history.js']
    manifest['codeSha256'] = {f: sha(ROOT / f) for f in code}
    manifest['frozenAt'] = datetime.now(timezone.utc).isoformat()
    (args.out / 'manifest.json').write_text(json.dumps(manifest, indent=2, allow_nan=False) + '\n')


if __name__ == '__main__':
    main()

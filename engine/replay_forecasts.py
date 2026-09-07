"""Compare frozen forecasts on saved as-of inputs, with exact final-label joins.

CFB uses cached final CFBD /plays and ESPN reviews. Other leagues require their
own source-aligned labels; this script never guesses NFL/ESPN identity mappings.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.parse import urlparse, parse_qs

import pandas as pd

import audit_cfb_labels
import coaching_pilot as pilot
import ingest_cfb

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def college_labels(game, review, source, source_hash):
    if game['meta']['league'] != 'cfb' or source.get('status') != 200 or not isinstance(source.get('payload'), list):
        raise ValueError('A successful cached college play response is required')
    if review['key'] != game['key'] or review['status'] != 'final':
        raise ValueError('Final review does not match the journal')
    query = parse_qs(urlparse(source['url']).query)
    year = int(query['year'][0])
    names = {str(t['id']): t['shortName'] for t in review['teams']}
    raw = [p for p in source['payload'] if str(p.get('gameId')) == str(game['meta']['gameId'])]
    if len({str(p['id']) for p in raw}) != len(raw):
        raise ValueError('Duplicate final source play identity')
    by_id = {str(p['id']): p for p in raw}
    plays, rejected = {}, []
    for p in review['plays']:
        row = by_id.get(str(p['id']))
        team = str(p['report'].get('start', {}).get('team', {}).get('id', ''))
        if not row or not names.get(team) or names[team] != row.get('offense'):
            rejected.append(str(p['id']))
            continue
        label = audit_cfb_labels.label(row)
        clock = ingest_cfb.text_clock(row.get('playText'))
        if clock is None:
            c = row.get('clock') or {}
            if isinstance(c.get('minutes'), int) and isinstance(c.get('seconds'), int):
                clock = c['minutes'] * 60 + c['seconds']
        a, b = row.get('offenseScore'), row.get('defenseScore')
        label.update({k: row.get(k) for k in ['down', 'distance', 'yardsToGoal', 'period']})
        label.update({'offenseId': team, 'clockSeconds': clock, 'scoreDiff': a - b if isinstance(a, int) and isinstance(b, int) else None})
        plays[str(p['id'])] = label
    return {'kind': 'aligned-final-labels', 'key': game['key'], 'season': year, 'plays': plays,
            'sourceSha256': source_hash, 'sourceUrl': source['url'], 'sourceRetrievedAt': source['retrievedAt'],
            'rejectedIds': rejected}


def summarize(results):
    output = {}
    for league in ['nfl', 'cfb']:
        games = [g for g in results if g['league'] == league]
        eligible = [dict(r, game_id=g['game']) for g in games for r in g['rows'] if r['eligible']]
        cohorts = {}
        for name in ['development', 'prospective']:
            rows = [r for r in eligible if r['cohort'] == name]
            counts = {'plays': len(rows), 'games': len({r['game_id'] for r in rows}),
                      'displayedProbabilities': sum(r['displayed'] is not None for r in rows), 'scores': None}
            if name == 'prospective' and counts['plays'] >= 2000 and counts['games'] >= 20:
                p = pd.DataFrame([{'game_id': r['game_id'], 'actual': r['actual'], 'baseline': r['baseline'],
                                   'candidate': r['candidate']['probability']} for r in rows])
                counts['scores'] = {m: pilot.metrics(p, m) for m in ['baseline', 'candidate']}
                counts['pairedBrier'] = pilot.paired_bootstrap(p, 'candidate', 'baseline')
            else:
                counts['scoreUnavailable'] = 'Development sample' if name == 'development' else 'Needs 2000 eligible plays across 20 games'
            cohorts[name] = counts
        output[league] = {'journalGames': len(games), 'cohorts': cohorts,
                          'savedGuidance': sum(len(g['rows']) for g in games),
                          'excludedRecords': sum(not r['eligible'] for g in games for r in g['rows']),
                          'exclusions': dict(Counter(reason for g in games for r in g['rows'] for reason in r['reasons']))}
    return output


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--freeze', required=True, type=Path)
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--labels-dir', type=Path, help='Verified aligned-final-labels files for leagues without a cached adapter')
    p.add_argument('journals', nargs='+', type=Path)
    args = p.parse_args()
    manifest_path = args.freeze / 'manifest.json'
    freeze = json.loads(manifest_path.read_text())
    results, seen = [], set()
    for path in args.journals:
        game = json.loads(path.read_text())
        if game['key'] in seen:
            raise ValueError('Duplicate game export: use one complete journal per game')
        seen.add(game['key'])
        league = game['meta']['league']
        entry = freeze['leagues'][league]
        files = {name: args.freeze / entry[name + 'File'] for name in ['candidate', 'baseline']}
        for name, model_path in files.items():
            if sha(model_path) != entry[name + 'Sha256']:
                raise ValueError('Frozen model bytes changed: ' + name)
        key = game['key'].replace(':', '-')
        provenance = {'journalSha256': sha(path), 'candidateSha256': entry['candidateSha256'], 'baselineSha256': entry['baselineSha256']}
        if league == 'cfb':
            review_path = ROOT / 'web/reviews' / (key + '.json')
            sources = sorted((ROOT / 'data/raw/reviews' / key).glob('cfbd-plays-*.json'))
            if not sources:
                raise ValueError('No cached final college /plays response for ' + key)
            source_path = sources[-1]
            labels = college_labels(game, json.loads(review_path.read_text()), json.loads(source_path.read_text()), sha(source_path))
            provenance.update({'reviewSha256': sha(review_path), 'sourceSha256': sha(source_path),
                               'classifierSha256': sha(ROOT / 'engine/ingest_cfb.py'), 'rejectedSourceJoins': labels['rejectedIds']})
        else:
            if not args.labels_dir:
                raise ValueError('NFL needs an exact-game aligned-final-labels artifact; none supplied')
            labels_path = args.labels_dir / (key + '.json')
            labels = json.loads(labels_path.read_text())
            provenance['labelArtifactSha256'] = sha(labels_path)
        payload = {'game': game, 'labels': labels, 'freeze': freeze,
                   **{name: json.loads(f.read_text()) for name, f in files.items()}}
        script = "const fs=require('fs'),a=require('./engine/forecast_replay.js'),d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(a.replay(d.game,d.labels,d.candidate,d.baseline,d.freeze)));"
        run = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps(payload), text=True, capture_output=True, check=True)
        result = json.loads(run.stdout); result['provenance'] = provenance
        results.append(result)
    report = {'schemaVersion': 1, 'status': 'research_only', 'freezeSha256': sha(manifest_path),
              'frozenAt': freeze['frozenAt'], 'summary': summarize(results), 'games': results,
              'accuracyImprovementEstablished': False, 'liveReplacementApproved': False}
    code = ['engine/replay_forecasts.py', 'engine/forecast_replay.js', 'engine/audit_cfb_labels.py',
            'engine/ingest_cfb.py', 'engine/tendency.py', 'engine/coaching_pilot.py', 'web/context-model.js', 'web/game-history.js']
    report['codeSha256'] = {f: sha(ROOT / f) for f in code}
    args.out.write_text(json.dumps(pilot.serializable(report), indent=2, allow_nan=False) + '\n')
    print(json.dumps(report['summary'], indent=2))


if __name__ == '__main__':
    main()

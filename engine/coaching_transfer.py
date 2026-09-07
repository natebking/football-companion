"""Expanded, fixed-method caller transfer evaluation; never writes web tables."""
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

import coaching_pilot as pilot
import schema

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'engine/coaching-expanded-sources.json'
MODELS = ['team', 'tenure', 'career', 'blend']


def transfer_starts(catalog):
    stints = {}
    for a in catalog['assignments']:
        key = (a['callerId'], a['tenureId'], a['team'])
        stints[key] = min(stints.get(key, 9999), min(a['seasons']))
    return {tenure: first for (caller, tenure, team), first in stints.items()
            if any(c == caller and t != team and year < first for (c, _, t), year in stints.items())}


def evaluate(frame, catalog, holdouts=pilot.HOLDOUTS):
    d = pilot.prepare(frame, catalog)
    if d.duplicated(['game_id', 'play_id']).any():
        raise ValueError('Duplicate eligible identities')
    folds, predictions = [], []
    for year in holdouts:
        inner, validation, train, test = pilot.chronological_split(d, year)
        ck, ik, cc, ic = pilot.tune(inner, validation)
        context = pilot.fit_context(train, ck)
        selected = test[test.caller.notna()].copy()
        p = selected[['season','game_id','play_id','offense','caller','tenure','actual']].rename(columns={'tenure':'tenure_id'}).copy()
        for name, identity in [('team','offense'),('tenure','tenure'),('career','caller')]:
            fitted = pilot.fit_identity(train, context, identity, ik)
            p[name] = pilot.predict_identity(context, fitted, selected, identity)
        p['blend'] = (p.team + p.career) / 2
        folds.append({'holdout':year, 'trainThrough':year-1, 'validationSeason':year-1,
                      'contextK':ck, 'identityK':ik, 'contextCurve':cc, 'identityCurve':ic})
        predictions.append(p)
    p = pd.concat(predictions, ignore_index=True)
    starts = transfer_starts(catalog)
    p['transfer'] = p.tenure_id.isin(starts)
    p['firstTransferSeason'] = p.season.eq(p.tenure_id.map(starts)).fillna(False)
    if not p.transfer.any():
        raise ValueError('No transfer stints in the evaluation; do not write an empty result')
    return d, p, folds


def result(frame):
    if frame.empty:
        return None
    return {'plays':len(frame), 'games':int(frame.game_id.nunique()),
            'metrics':{name:pilot.metrics(frame, name) for name in MODELS},
            'versusTeam':{name:pilot.paired_bootstrap(frame, name, 'team') for name in MODELS if name != 'team'}}


def passer_context(frame):
    # Named passers are descriptive metadata, never inputs to this experiment.
    covered = frame[frame.caller.notna()][['season','game_id','play_id','offense','caller']]
    summaries, sources = [], []
    for year, rows in covered.groupby('season'):
        path = ROOT / f'data/raw/nfl_pbp_{year}.parquet'
        raw = pd.read_parquet(path, columns=['game_id','play_id','posteam','passer_player_id','passer_player_name','season_type'])
        raw['play_id'] = raw.play_id.astype(int).astype(str)
        joined = rows.merge(raw, on=['game_id','play_id'], how='left', validate='one_to_one')
        if not joined.offense.eq(joined.posteam).all():
            raise ValueError('Raw passer join did not preserve offense')
        if not joined.season_type.isin(['REG','POST']).all():
            raise ValueError('Unexpected season type in caller experiment')
        for (team, caller), group in joined.groupby(['offense','caller']):
            named = group.dropna(subset=['passer_player_id','passer_player_name'])
            counts = named.groupby(['passer_player_id','passer_player_name']).size().sort_values(ascending=False)
            summaries.append({'season':int(year), 'team':team, 'caller':caller, 'eligiblePlays':len(group),
                'namedPassingPlays':len(named), 'mostFrequentPassers':[{'id':id, 'name':name, 'plays':int(n)} for (id,name),n in counts.head(3).items()]})
        sources.append({'file':path.name, 'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    return summaries, sources


def main():
    catalog = json.loads(CATALOG.read_text())
    path = ROOT / 'data/coaching-pilot/plays_nfl_2018_2025.parquet'
    d, p, folds = evaluate(schema.read_plays(path), catalog)
    passers, sources = passer_context(d)
    report = {'schemaVersion':1, 'status':'research_only', 'protocol':'COACHING-TRANSFER-PROTOCOL-2026-09-06.md',
        'catalogSha256':hashlib.sha256(CATALOG.read_bytes()).hexdigest(), 'inputSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
        'callers':sorted(p.caller.unique()), 'folds':folds, 'allCovered':result(p), 'transferStints':result(p[p.transfer]),
        'firstTransferSeasons':result(p[p.firstTransferSeason]),
        'byCaller':{name:result(group) for name,group in p[p.transfer].groupby('caller')},
        'byTransferTenure':{name:result(group) for name,group in p[p.transfer].groupby('tenure_id')},
        'passerContext':passers, 'rawSources':sources, 'limitations':catalog['limitations'] + [
            'Intervals concern sampled games; three callers cannot establish generalization to all coaches.',
            'Named-passers summaries are not causal adjustment or verified starting-QB labels.',
            'Retrospective finalized data and previously studied seasons do not establish prospective live performance.']}
    out = ROOT / 'data/coaching-pilot/expanded'; out.mkdir(exist_ok=True)
    p.to_parquet(out/'predictions.parquet', index=False)
    (ROOT/'docs/coaching-expanded-audit.json').write_text(json.dumps(pilot.serializable(report), indent=2, allow_nan=False)+'\n')
    print(json.dumps(pilot.serializable({'transfer':report['transferStints']['versusTeam'],
        'firstSeason':report['firstTransferSeasons']['versusTeam'], 'byCaller':{k:v['versusTeam']['career'] for k,v in report['byCaller'].items()}})), flush=True)


if __name__ == '__main__':
    main()

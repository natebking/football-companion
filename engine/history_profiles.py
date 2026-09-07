"""Export descriptive team/opponent outcomes from the preceding season.

No fitted probabilities or opponent-quality claims. Exact context cells only;
small samples remain absent. Run: .venv/bin/python engine/history_profiles.py
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re

import numpy as np
import pandas as pd

import schema
import source_context
import tendency

ROOT = Path(__file__).resolve().parents[1]
MIN_PLAYS = 20
MIN_GAMES = 5
MIN_ACTION_PLAYS = 15
GZIP_BUDGET = 200 * 1024


def context(frame):
    d = frame
    valid = d.down.between(1, 4) & d.distance.between(1, 99) & d.distance.le(d.yards_to_goal) & d.yards_to_goal.between(1, 99) & d.period.between(1, 4) & d.clock_seconds.between(0, 900) & d.score_diff.notna()
    band = np.select([d.distance.le(3).fillna(False).to_numpy(bool), d.distance.le(6).fillna(False).to_numpy(bool)], ['short', 'medium'], default='long')
    zone = np.select([d.distance.eq(d.yards_to_goal).fillna(False).to_numpy(bool), d.yards_to_goal.le(20).fillna(False).to_numpy(bool)], ['goal', 'red'], default='open')
    score = np.select([d.score_diff.ge(9).fillna(False).to_numpy(bool), d.score_diff.le(-9).fillna(False).to_numpy(bool)], ['ahead', 'behind'], default='close')
    phase = np.select([((d.period == 4) & (d.clock_seconds <= 300)).fillna(False).to_numpy(bool),
                       ((d.period == 2) & (d.clock_seconds <= 120)).fillna(False).to_numpy(bool)], ['late', 'half'], default='ordinary')
    keys = pd.Series(['d' + str(down) + '|' + b + '|' + z + '|' + s + '|' + p
                      for down, b, z, s, p in zip(d.down, band, zone, score, phase)], index=d.index)
    return keys.where(valid.fillna(False))


def college_conversion(row):
    """Unknown penalties/fumbles stay unknown; never call them failures or gains.

    Ordinary non-turnover gain at or beyond the line establishes the conversion.
    We intentionally do not infer possession through a fumble from its type label.
    """
    text = re.split(r'\bOriginal Play:', row.play_text if isinstance(row.play_text, str) else '', maxsplit=1, flags=re.I)[0]
    if re.search(r'\bpenalt|\bfumbl', text, re.I) or 'Fumble' in row.play_type_raw:
        return None
    if 'Interception' in row.play_type_raw or re.search(r'\bintercept', text, re.I):
        return False
    if row.play_type_raw in ('Passing Touchdown', 'Rushing Touchdown'):
        return True
    if pd.isna(row.yards_gained) or pd.isna(row.distance):
        return None
    if row.play_type_raw in ('Pass Incompletion', 'Sack'):
        return False
    if row.play_type_raw not in ('Pass Reception', 'Pass Completion', 'Rush'):
        return None
    return bool(row.yards_gained >= row.distance)


def attach_outcomes(frame, league, season):
    d = frame.copy()
    if league == 'cfb':
        d['converted'] = [college_conversion(row) for row in d.itertuples()]
        # An accepted penalty may make source yardage differ from the play gain.
        current_text = d.play_text.fillna('').str.split(r'(?i)\bOriginal Play:', n=1, regex=True).str[0]
        ambiguous = current_text.str.contains(r'\bpenalt|\bfumbl|\bintercept', case=False, regex=True, na=False) | d.play_type_raw.str.contains('Fumble|Interception', na=False)
        d.loc[ambiguous, 'yards_gained'] = pd.NA
    else:
        path = ROOT / f'data/raw/nfl_pbp_{season}.parquet'
        raw = pd.read_parquet(path, columns=['game_id', 'play_id', 'posteam', 'first_down', 'touchdown', 'td_team', 'fumble_lost', 'interception', 'penalty'])
        raw['play_id'] = raw.play_id.astype(int).astype(str)
        if raw.duplicated(['game_id', 'play_id']).any():
            raise ValueError('Duplicate nflverse raw play IDs')
        raw = raw.set_index(['game_id', 'play_id'])
        joined = raw.reindex(pd.MultiIndex.from_frame(d[['game_id', 'play_id']]))
        team_matches = joined.posteam.to_numpy() == d.offense.to_numpy()
        known = joined.first_down.notna() & joined.fumble_lost.notna() & joined.interception.notna() & joined.penalty.eq(0)
        converted = (joined.first_down.eq(1) | (joined.touchdown.eq(1) & joined.td_team.eq(joined.posteam))) & joined.fumble_lost.eq(0) & joined.interception.eq(0)
        d['converted'] = [bool(value) if ok and same else None for value, ok, same in zip(converted, known, team_matches)]
        d.loc[~team_matches | joined.penalty.ne(0).to_numpy(), 'yards_gained'] = pd.NA
    return d


def aggregate(group):
    known = group.converted.notna()
    out = {'n': len(group), 'games': int(group.game_id.nunique()),
           'conversionKnown': int(known.sum()), 'conversions': int(group.loc[known, 'converted'].sum())}
    for action, column in [('run', 'is_rush'), ('pass', 'is_pass')]:
        a = group[group[column]]
        yards = a.yards_gained.dropna()
        out[action] = {'n': len(a), 'yardsKnown': len(yards),
                       'twoOrLess': int(yards.le(2).sum()), 'fivePlus': int(yards.ge(5).sum()),
                       'tenPlus': int(yards.ge(10).sum()),
                       'median': float(yards.median()) if len(yards) else None}
    return out


def build(frame, league, season):
    if not frame.league.eq(league).all():
        raise ValueError('Mixed league input')
    source, alignment = source_context.align(frame[frame.season.eq(season)], league)
    d = tendency.eligible(source).copy()
    d['context'] = context(d)
    d = d[d.context.notna()].copy()
    if d.duplicated(['game_id', 'play_id']).any():
        raise ValueError('Duplicate historical play IDs')
    d = attach_outcomes(d, league, season)
    sides, coverage = {}, {}
    for side in ['offense', 'defense']:
        sides[side] = {}
        covered = 0
        for (team, key), group in d.groupby([side, 'context'], observed=True):
            if len(group) < MIN_PLAYS or group.game_id.nunique() < MIN_GAMES:
                continue
            cell = aggregate(group)
            sides[side].setdefault(team, {})[key] = cell
            covered += len(group)
        coverage[side] = {'teams': len(sides[side]), 'cells': sum(map(len, sides[side].values())), 'coveredPlays': covered}
    data = {'schemaVersion': 1, 'version': 'history-1', 'league': league, 'season': season,
            'minPlays': MIN_PLAYS, 'minGames': MIN_GAMES, 'minActionPlays': MIN_ACTION_PLAYS,
            'source': {'label': 'CollegeFootballData' if league == 'cfb' else 'nflverse',
                       'url': 'https://api.collegefootballdata.com/api/plays' if league == 'cfb' else 'https://nflreadr.nflverse.com/articles/dictionary_pbp.html'},
            'note': 'Describes last season, with different opponents, players and potentially coaches. Not a forecast or a recommendation to run or pass. Unclear outcomes are counted separately.',
            'offense': sides['offense'], 'defense': sides['defense']}
    data['id'] = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    raw = json.dumps(data, separators=(',', ':'), allow_nan=False).encode()
    size = len(gzip.compress(raw, mtime=0))
    if size > GZIP_BUDGET:
        raise ValueError(f'History transfer budget exceeded: {size}')
    report = {'league': league, 'season': season, 'qualifyingPlays': len(d), 'games': int(d.game_id.nunique()),
              'conversionKnown': int(d.converted.notna().sum()), 'conversionUnknown': int(d.converted.isna().sum()),
              'coverage': coverage, 'gzipBytes': size, 'alignment': alignment, 'datasetId': data['id']}
    return data, report, d


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--season', type=int, default=2025)
    args = parser.parse_args()
    reports = []
    for league in ['nfl', 'cfb']:
        path = ROOT / f'data/plays_{league}.parquet'
        data, report, d = build(schema.read_plays(path), league, args.season)
        report['unifiedInputSha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        if league == 'nfl':
            report['outcomeInputSha256'] = hashlib.sha256((ROOT / f'data/raw/nfl_pbp_{args.season}.parquet').read_bytes()).hexdigest()
        (ROOT / f'web/history-{league}.json').write_text(json.dumps(data, separators=(',', ':'), allow_nan=False) + '\n')
        out = ROOT / 'data/history-profiles'
        out.mkdir(parents=True, exist_ok=True)
        d.to_parquet(out / f'{league}-{args.season}.parquet', index=False)
        reports.append(report)
        print(json.dumps(report), flush=True)
    (ROOT / 'docs/history-profiles-audit.json').write_text(json.dumps({'schemaVersion': 1, 'results': reports}, indent=2) + '\n')


if __name__ == '__main__':
    main()

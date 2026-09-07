'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { replay, baselineProbability } = require('../engine/forecast_replay.js');
function fixture() {
  const situation = { gameId: '123', season: 2026, seasonType: 2, offenseTeam: { id: '1', abbreviation: 'A' },
    down: 1, distance: 10, yardsToGoal: 70, period: 4, clockSeconds: 500, scoreDiff: 7 };
  return {
    game: { schemaVersion: 1, key: 'nfl:123', meta: { league: 'nfl', gameId: '123', teams: [{ id: '1' }] },
      sources: [{ revisionId: 'p1:1', playId: 'p1', observedAt: 800, report: { id: 'p1' } },
        { revisionId: 'p2:1', playId: 'p2', observedAt: 2000, report: { id: 'p2' } }],
      releases: [{ revisionId: 'p1:1', playId: 'p1', at: 900 }],
      shown: [{ id: 's1', kind: 'guidance', shownAt: 1000, visibility: 'visible', basisPlayId: 'p1', basisRevision: 1,
        probabilityShown: .4, situation }],
      observations: [{ kind: 'resolution', shownId: 's1', playId: 'p2', voided: false }] },
    labels: { kind: 'aligned-final-labels', key: 'nfl:123', season: 2026, sourceSha256: 'synthetic-test-source',
      plays: { p2: { eligible: true, passLabel: 1, offenseId: '1', down: 1, distance: 10, yardsToGoal: 70,
        period: 4, clockSeconds: 500, scoreDiff: 7 } } },
    candidate: { schemaVersion: 1, league: 'nfl', throughSeason: 2025, k: 60, overall: .5,
      leagueRates: {}, contexts: {}, teams: { 'A|d1_long': { offset: .1, n: 10 } }, calibration: { slope: 1, intercept: 0 } },
    baseline: { league: 'nfl', seasons: [2023, 2024, 2025], league_overall: { pass_rate: .4 },
      league_baseline: {}, teams: { A: {} } },
    freeze: { targetSeason: 2026, frozenAt: new Date(500).toISOString() }
  };
}
function run(f) { return replay(f.game, f.labels, f.candidate, f.baseline, f.freeze); }

test('saved pre-arrival context supplies the forecast, independently of later results or context', () => {
  const f = fixture(), first = run(f).rows[0];
  assert.equal(first.eligible, true); assert.equal(first.cohort, 'prospective');
  assert.equal(first.baseline, .4); assert.ok(Math.abs(first.candidate.probability - .6) < 1e-12);
  f.labels.plays.p2.passLabel = 0; f.labels.plays.p2.clockSeconds = 0; f.labels.plays.p2.scoreDiff = -14;
  const second = run(f).rows[0];
  assert.deepEqual(first.input, second.input); assert.deepEqual(first.candidate, second.candidate);
  assert.deepEqual(second.laterContextDifferences, ['clockSeconds', 'scoreDiff']);
  assert.notDeepEqual(first.brier, second.brier);
});

test('a matching situation cannot substitute for an explicit target link', () => {
  const f = fixture(); f.game.observations = [];
  assert.ok(run(f).rows[0].reasons.includes('no_explicit_target'));
  f.game.observations = [{ kind: 'resolution', shownId: 's1', playId: 'p2' }, { kind: 'resolution', shownId: 's1', playId: 'p3' }];
  assert.ok(run(f).rows[0].reasons.includes('conflicting_target_links'));
});

test('a target already received, unreleased basis, or background card cannot count', () => {
  for (const change of [f => f.game.sources[1].observedAt = 1000, f => f.game.releases[0].at = 1100,
    f => f.game.shown[0].visibility = 'background', f => f.game.shown[0].historicalOnArrival = true]) {
    const f = fixture(); change(f); assert.equal(run(f).summary.eligibleCounterfactuals, 0);
  }
});

test('latest visible linked input wins, even if later label/context validation fails', () => {
  const f = fixture();
  f.game.shown.push({ ...structuredClone(f.game.shown[0]), id: 's2', shownAt: 1500 });
  f.game.observations.push({ kind: 'resolution', shownId: 's2', playId: 'p2' });
  let result = run(f);
  assert.equal(result.summary.eligibleCounterfactuals, 1);
  assert.ok(result.rows[0].reasons.includes('superseded_visible_input'));
  f.game.shown[1].situation.scoreDiff = null;
  result = run(f);
  assert.equal(result.summary.eligibleCounterfactuals, 0);
  assert.equal(result.rows[1].baseline, .4, 'The baseline did not require the missing score.');
  assert.ok(result.rows[1].reasons.includes('unknown_model_context'));
});

test('quiz voids are not model outcome labels; hidden rates are not displayed forecasts', () => {
  const f = fixture(); f.game.observations[0].voided = true;
  f.game.shown[0].probabilityShown = null;
  assert.equal(run(f).summary.eligibleCounterfactuals, 1);
  assert.equal(run(f).summary.displayedProbabilityLinks, 0);
  f.labels.plays.p2.eligible = false; f.labels.plays.p2.passLabel = null;
  assert.equal(run(f).summary.eligibleCounterfactuals, 0);
});

test('training horizon, source identity, explicit season and pre-freeze sessions remain distinct', () => {
  const f = fixture(); f.candidate.throughSeason = 2026;
  assert.throws(() => run(f), /training horizon/);
  f.candidate.throughSeason = 2025; f.labels.key = 'nfl:999';
  assert.throws(() => run(f), /Exact-game/);
  f.labels.key = f.game.key; f.freeze.frozenAt = new Date(5000).toISOString();
  delete f.game.shown[0].situation.season;
  const row = run(f).rows[0];
  assert.equal(row.eligible, true); assert.equal(row.cohort, 'development');
  assert.deepEqual(row.prospectiveExclusions, ['before_candidate_freeze', 'season_not_saved_or_outside_target']);
});

test('an offense or target position mismatch cannot be fixed by replacing the saved input', () => {
  const f = fixture(); f.labels.plays.p2.yardsToGoal = 50;
  const r = run(f).rows[0];
  assert.ok(r.reasons.includes('target_situation_mismatch')); assert.equal(r.input.yardsToGoal, 70);
  f.game.shown[0].situation.offenseTeam = {};
  assert.ok(run(f).rows[0].reasons.includes('unknown_saved_offense'));
});

test('the frozen baseline uses the attributable team rate or the actual league fallback', () => {
  const f = fixture(), input = { team: 'A', down: 3, distance: 6, yardsToGoal: 30 };
  f.baseline.teams.A.d3_medium_opp = { pass_rate: .7, can_attribute: false };
  assert.equal(baselineProbability(f.baseline, input), .4);
  f.baseline.teams.A.d3_medium_opp.can_attribute = true;
  assert.equal(baselineProbability(f.baseline, input), .7);
  assert.equal(baselineProbability(f.baseline, { ...input, down: 0 }), null);
});

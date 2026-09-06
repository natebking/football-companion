const test = require('node:test');
const assert = require('node:assert/strict');
const context = require('../web/context-model.js');
const s = { league: 'nfl', team: 'DEN', down: 2, distance: 7, yardsToGoal: 20, period: 4, clockSeconds: 120, scoreDiff: -9 };
const model = { schemaVersion: 1, league: 'nfl', throughSeason: 2024, k: 60, overall: .5,
  leagueRates: {}, contexts: {}, teams: {}, calibration: { slope: 1, intercept: 0 } };
test('unknown score, clock, league and invalid distances cannot silently become an estimate', () => {
  for (const change of [{ scoreDiff: null }, { clockSeconds: null }, { league: 'cfb' }, { distance: 0 }, { period: 0 }, { down: 5 }]) {
    assert.equal(context.predict(model, { ...s, ...change }), null);
  }
});
test('an unseen team uses league context and discloses the absent team sample', () => {
  const key = context.keys(s);
  assert.equal(key.context, 'd2_medium_opp|behind_9plus|last_2min');
  const m = structuredClone(model);
  m.contexts[key.context] = { weightedN: 60, weightedPasses: 60, n: 90, games: 20 };
  const p = context.predict(m, s);
  assert.ok(Math.abs(p.probability - .75) < 1e-12);
  assert.equal(p.teamSample, 0);
  assert.equal(p.contextSample, 90);
});
test('no play result or raw description is consulted', () => {
  const safe = { ...s };
  for (const field of ['outcome', 'playText', 'nextPlay', 'raw']) Object.defineProperty(safe, field, { get() { throw Error('Future result accessed'); } });
  assert.equal(context.predict(model, safe).probability, .5);
});

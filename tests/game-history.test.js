const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../web/game-history.js');
const read = require('../web/game-read.js');
const data = require('../web/history-cfb.json');
const nfl = require('../web/history-nfl.json');
const s = { gameId: 'history-test', season: 2026, seasonType: 2, down: 3, distance: 8,
  yardsToGoal: 70, period: 1, clockSeconds: 600, scoreDiff: 0,
  offenseTeam: { id: '2483', location: 'Oregon' }, defenseTeam: { id: '68', location: 'Boise State' } };

test('team and opponent are joined separately in the same offensive situation bands', () => {
  const past = h.lookup(data, s, 'cfb');
  assert.equal(past.key, 'd3|long|open|close|ordinary');
  assert.equal(past.rows[0].team, 'Oregon');
  assert.equal(past.rows[1].team, 'Boise State');
  assert.equal(past.rows[0].cell, data.offense.Oregon[past.key]);
  assert.equal(past.rows[1].cell, data.defense['Boise State'][past.key]);
  const c = read.select(s, null, [], past);
  assert.equal(c.id, 'history_third_down');
  assert.equal(c.historyRefs.length, 2);
  assert.match(c.detail, /Offenses facing Boise State/);
});
test('unknown season, wrong league, preseason and future or stale history never appear', () => {
  for (const change of [{ season: null }, { season: 2025 }, { season: 2027 }, { seasonType: null }, { seasonType: 1 },
    { clockSeconds: null }, { scoreDiff: null }, { distance: 0 }, { period: 5 }, { defenseTeam: null }]) {
    assert.equal(h.lookup(data, { ...s, ...change }, 'cfb'), null, JSON.stringify(change));
  }
  assert.equal(h.lookup(data, s, 'nfl'), null);
});
test('thin data stays absent, with no broader situation or different team substituted', () => {
  const copy = structuredClone(data), key = h.context(s);
  copy.offense.Oregon[key].n = 19; copy.defense['Boise State'][key].games = 4;
  assert.equal(h.lookup(copy, s, 'cfb'), null);
  assert.equal(h.lookup(data, { ...s, offenseTeam: { id: 'x', name: 'Unlisted' }, defenseTeam: { id: 'y', name: 'Unlisted' } }, 'cfb'), null);
});
test('unknown outcomes are not failures and high missingness suppresses the statistic', () => {
  const cell = structuredClone(data.offense.Oregon[h.context(s)]);
  cell.run = { n: 0, yardsKnown: 0 };
  cell.pass = { n: 20, yardsKnown: 20 };
  cell.conversionKnown = 20; cell.conversions = 10; cell.n = 23;
  assert.equal(h.conversion(cell), false);
  cell.n = 22; assert.equal(h.conversion(cell), true);
  cell.run = { n: 20, yardsKnown: 15, twoOrLess: 4, fivePlus: 8, tenPlus: 2 };
  assert.equal(h.metric(cell, 'run'), null);
  cell.run.yardsKnown = 18; assert.ok(h.metric(cell, 'run'));
  cell.run.tenPlus = 19; assert.equal(h.metric(cell, 'run'), null);
});
test('a past-game card cannot leak across possession, situation or game changes', () => {
  const past = h.lookup(data, s, 'cfb');
  for (const change of [{ gameId: 'different' }, { distance: 3 }, { offenseTeam: s.defenseTeam }, { defenseTeam: s.offenseTeam }]) {
    assert.equal(h.read({ ...s, ...change }, past), null);
  }
  const c = read.select(s, null, [], past);
  assert.notEqual(read.select(s, null, [c.key], past)?.id, c.id);
  const fourth = { ...s, down: 4 };
  assert.equal(read.select(fourth, null, [], h.lookup(data, fourth, 'cfb')).id, 'fourth_down');
});
test('NFL aliases match exact team codes without name substring guesses', () => {
  assert.equal(h.teamKey({ abbreviation: 'LAR' }, 'nfl', nfl.offense), 'LA');
  assert.equal(h.teamKey({ abbreviation: 'WSH' }, 'nfl', nfl.offense), 'WAS');
  assert.equal(h.teamKey({ location: 'Oregon State' }, 'cfb', { Oregon: {} }), null);
});
test('journal replay needs the exact historical dataset used by a recorded read', () => {
  const { auditGame } = require('../engine/journal_audit.js');
  const c = read.select(s, null, [], h.lookup(data, s, 'cfb'));
  const game = { schemaVersion: 1, key: 'cfb:123', meta: { gameId: s.gameId, league: 'cfb', teams: [] }, sources: [], releases: [],
    shown: [{ id: 'one', kind: 'guidance', shownAt: 100, visibility: 'visible', situation: s, read: c,
      lines: { watch: c.headline, detail: c.detail, observation: c.watch } }], observations: [] };
  assert.equal(auditGame(game, null, data).summary.reproduced, 1);
  assert.equal(auditGame(game, null).summary.unverifiableHistory, 1);
  assert.equal(auditGame(game, null, { ...data, id: 'another' }).rows[0].reproducible, null);
});

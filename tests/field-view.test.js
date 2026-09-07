'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Field = require('../web/field-view.js');
const A = { id: '1', abbreviation: 'A' }, B = { id: '2', abbreviation: 'B' };
function sit(overrides = {}) { return { gameId: '123', period: 1, offenseTeam: A, defenseTeam: B, yardsToGoal: 75, distance: 10, ...overrides }; }
function storage() { const m = new Map(); return { getItem: k => m.get(k), setItem: (k, v) => m.set(k, v) }; }

test('TV match mirrors the ball, target, labels and direction while preserving football distances', () => {
  const f = Field.create({ storage: storage() }), s = sit();
  assert.equal(f.view(s, 'cfb').matched, false);
  f.match(s, 'cfb', false);
  const v = f.view(s, 'cfb');
  assert.equal(v.matched, true); assert.equal(v.right, false);
  assert.equal(v.geometry.ball, 360); assert.equal(v.geometry.target, 316);
  assert.equal(v.leftTeam.id, B.id); assert.equal(v.rightTeam.id, A.id);
  assert.equal(s.yardsToGoal, 75); assert.equal(s.distance, 10);
});
test('possession changes keep the teams at the same ends in regulation and NFL overtime', () => {
  for (const league of ['cfb', 'nfl']) {
    for (const period of league === 'nfl' ? [1, 5] : [1]) {
      const f = Field.create({ storage: storage() }), s = sit({ period });
      f.match(s, league, true);
      const changed = f.view(sit({ period, offenseTeam: B, defenseTeam: A, yardsToGoal: 25 }), league);
      assert.equal(changed.right, false); assert.equal(changed.leftTeam.id, A.id);
      assert.equal(changed.rightTeam.id, B.id); assert.equal(changed.geometry.ball, 140);
    }
  }
});
test('ends swap only within the same regulation half and correction back to a prior quarter is deterministic', () => {
  const f = Field.create({ storage: storage() });
  f.match(sit(), 'cfb', true);
  assert.equal(f.view(sit({ period: 2 }), 'cfb').right, false);
  assert.equal(f.view(sit(), 'cfb').right, true);
  assert.equal(f.view(sit({ period: 3 }), 'cfb').matched, false);
  f.match(sit({ period: 3 }), 'cfb', false);
  assert.equal(f.view(sit({ period: 4 }), 'cfb').right, true);
  assert.equal(f.view(sit({ period: 2 }), 'cfb').right, false);
  assert.equal(f.view(sit({ period: 5 }), 'cfb').matched, false);
});
test('college overtime keeps the selected goal for both possession series; each extra period is separate', () => {
  const f = Field.create({ storage: storage() });
  f.match(sit({ period: 5 }), 'cfb', false);
  const other = f.view(sit({ period: 5, offenseTeam: B, defenseTeam: A }), 'cfb');
  assert.equal(other.right, false); assert.equal(other.leftTeam.id, A.id);
  assert.equal(f.view(sit({ period: 6 }), 'cfb').matched, false);
});
test('choices survive reloads and game switches without leaking across games, leagues or team identities', () => {
  const s = storage(), f = Field.create({ storage: s });
  f.match(sit(), 'cfb', false);
  const again = Field.create({ storage: s });
  assert.equal(again.view(sit(), 'cfb').right, false);
  assert.equal(again.view(sit({ gameId: '456' }), 'cfb').matched, false);
  assert.equal(again.view(sit(), 'nfl').matched, false);
  assert.equal(again.view(sit({ defenseTeam: { id: '3' } }), 'cfb').matched, false);
});
test('unknown context and malformed storage do not imply a TV match; failed writes retain a session choice', () => {
  const s = storage(), f = Field.create({ storage: s });
  assert.equal(f.match(sit({ period: null }), 'cfb', true), false);
  assert.equal(f.match(sit({ defenseTeam: A }), 'cfb', true), false);
  s.setItem('ff_field_view_cfb:123', '{broken');
  assert.equal(f.view(sit(), 'cfb').matched, false);
  f.match(sit(), 'cfb', true);
  s.setItem = () => { throw Error('full'); };
  f.match(sit(), 'cfb', false);
  assert.equal(f.view(sit(), 'cfb').right, false);
});
test('goal-line targets and all legal field spots remain inside the field in either direction', () => {
  for (let y = 0; y <= 100; y++) for (const right of [true, false]) {
    const g = Field.geometry(sit({ yardsToGoal: y, distance: 10 }), right);
    assert.ok(g.ball >= 30 && g.ball <= 470); assert.ok(g.target >= 30 && g.target <= 470);
    assert.equal(g.goal, y <= 10);
    assert.ok(right ? g.target >= g.ball : g.target <= g.ball);
  }
  assert.equal(Field.geometry(sit({ yardsToGoal: null }), true), null);
});

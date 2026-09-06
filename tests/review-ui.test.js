const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ window: { document: {} } });
vm.runInContext(fs.readFileSync(require.resolve('../web/review-ui.js'), 'utf8'), context);
const fromESPN = context.window.FootballReview.fromESPN;
const summary = id => ({ header: { id, shortName: 'A @ B', competitions: [{ id, status: { type: { completed: true } }, competitors: [] }] }, drives: { previous: [] } });
test('a finished response must belong to the requested game', () => {
  assert.throws(() => fromESPN(summary('222'), 'cfb:111'), /does not match/);
  assert.throws(() => fromESPN({ header: { competitions: [{ status: { type: { completed: true } } }] } }, 'cfb:111'), /does not match/);
});
test('only a final game can enter review', () => {
  const s = summary('111'); s.header.competitions[0].status.type.completed = false;
  assert.throws(() => fromESPN(s, 'cfb:111'), /not marked final/);
});
test('review keeps stable source identity and latest duplicate revisions', () => {
  const s = summary('111');
  s.drives.previous = [{ id: 'drive1', plays: [{ id: 'p1', text: 'old' }] }];
  s.drives.current = { id: 'drive1', plays: [{ id: 'p1', text: 'corrected' }] };
  const r = fromESPN(s, 'cfb:111');
  assert.equal(r.key, 'cfb:111'); assert.equal(r.plays.length, 1);
  assert.equal(r.plays[0].report.text, 'corrected'); assert.equal(r.plays[0].report.driveId, 'drive1');
});
test('review selects different lessons, including a defensive stop, rather than only the biggest gains', () => {
  const row = (id, order, gained, need, down, e) => ({ p: { id, order, report: { start: { down } } }, f: { gained, need, meaning: 'Meaning.' }, e });
  const rows = [row('deep', 1, 50, 10, 1, { air: 48, after: 2 }), row('deeper', 2, 60, 10, 1, { air: 58, after: 2 }),
    row('runafter', 3, 25, 10, 1, { air: 3, after: 22 }), row('stop', 4, 5, 8, 3, null)];
  const chosen = context.window.FootballReview.selectMoments(rows);
  assert.deepEqual(Array.from(chosen, r => r.p.id), ['deeper', 'runafter', 'stop']);
});

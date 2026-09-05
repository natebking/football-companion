const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { inspectClocks } = require('../web/feed-health.js');
const fixture = require('./fixtures/feed-health.json');

function play(id, clock = '14:49', period = 4, type = 'Rush', text = 'Runner rush middle for 4 yards') {
  return { id, clock: { displayValue: clock }, period: { number: period }, type: { text: type }, text };
}
function status(clock = '14:49', period = 4) {
  return { displayClock: clock, period, type: { state: 'in' } };
}

test('real Oregon feed flags frozen current clock and an older frozen group', () => {
  const result = inspectClocks(fixture.plays, fixture.status);
  assert.equal(result.stalled, true);
  assert.equal(result.repeatedCount, 3); // Three scrimmage plays, not all seven Q4 rows.
  assert.equal(result.reportedClock, '14:49');
  assert.equal(result.period, 4);
  assert.ok(result.unreliableIds.includes('401858433623'));
  assert.ok(result.unreliableIds.includes('401858433518')); // Older Q3 5:36 group.
  assert.ok(result.unreliableIds.includes('401858433615')); // Affected penalty row also loses its misleading time.
});

test('two plays do not trigger a warning despite a long wall-clock gap', () => {
  const a = play('1'), b = play('2');
  a.wallclock = '2026-09-05T22:20:00Z';
  b.wallclock = '2026-09-05T22:40:00Z';
  const result = inspectClocks([a, b], status());
  assert.equal(result.stalled, false);
  assert.equal(result.repeatedCount, 2);
  assert.deepEqual(result.unreliableIds, []);
});

test('markers, kicks, conversions, penalties, kneels, and spikes do not count', () => {
  const rows = [play('1'), play('2')];
  for (const [type, text] of [
    ['Timeout', 'Timeout'], ['End Period', 'End of quarter'],
    ['Field Goal Good', 'Field goal good'], ['Kickoff', 'Kickoff'],
    ['Punt Return', 'Punt return'], ['Two Point Pass', 'Two-point pass attempt'],
    ['Penalty', 'Penalty'], ['Rush', 'Kneel down'],
    ['Pass Incompletion', 'Quarterback spikes the ball'],
    ['Pass Reception', 'Pass complete. PENALTY. NO PLAY'],
    ['Fumble Recovery (Opponent)', 'Punt fumbled by the returner']
  ]) rows.push(play(String(rows.length + 1), '14:49', 4, type, text));
  const result = inspectClocks(rows, status());
  assert.equal(result.repeatedCount, 2);
  assert.equal(result.stalled, false);
});

test('a touchdown with a later conversion penalty is still a scrimmage play', () => {
  const td = play('3', '14:49', 4, 'Rushing Touchdown', 'Runner rush for 1 yard TOUCHDOWN #4 A.Player pass attempt Successful PENALTY Holding. NO PLAY');
  assert.equal(inspectClocks([play('1'), play('2'), td], status()).stalled, true);
});

test('duplicate IDs count once and the latest corrected version wins', () => {
  const rows = [play('1'), play('2'), play('3'), play('3')];
  assert.equal(inspectClocks(rows, status()).repeatedCount, 3);
  rows.push(play('3', '14:49', 4, 'Penalty', 'Pass interference. NO PLAY'));
  const result = inspectClocks(rows, status());
  assert.equal(result.repeatedCount, 2);
  assert.equal(result.stalled, false);
});

test('new header time clears the current warning before another play arrives', () => {
  const result = inspectClocks([play('1'), play('2'), play('3')], status('14:03'));
  assert.equal(result.stalled, false);
  assert.equal(result.repeatedCount, 0);
  assert.deepEqual(result.unreliableIds, ['1', '2', '3']);
});

test('a new play time clears the warning while preserving bad historical labels', () => {
  const result = inspectClocks([play('1'), play('2'), play('3'), play('4', '14:03')], status('14:03'));
  assert.equal(result.stalled, false);
  assert.equal(result.repeatedCount, 1);
  assert.deepEqual(result.unreliableIds, ['1', '2', '3']);
});

test('clock changes break the group rather than pooling repeated values globally', () => {
  const rows = [play('1'), play('2'), play('3', '14:03'), play('4')];
  const result = inspectClocks(rows, status());
  assert.equal(result.stalled, false);
  assert.equal(result.repeatedCount, 1);
  assert.deepEqual(result.unreliableIds, []);
});

test('identical clock values in separate quarters do not form a group', () => {
  const result = inspectClocks([play('1', '14:49', 3), play('2', '14:49', 3), play('3')], status());
  assert.equal(result.stalled, false);
  assert.equal(result.repeatedCount, 1);
});

test('untimed overtime clocks are not classified as stalled', () => {
  const result = inspectClocks([play('1', '0:00', 5), play('2', '0:00', 5), play('3', '0:00', 5)], status('0:00', 5));
  assert.equal(result.stalled, false);
  assert.equal(result.period, 5);
  assert.deepEqual(result.unreliableIds, []);
});

test('final games retain historical flags without a current warning', () => {
  const result = inspectClocks([play('1'), play('2'), play('3')], { ...status(), type: { state: 'post', completed: true } });
  assert.equal(result.stalled, false);
  assert.deepEqual(result.unreliableIds, ['1', '2', '3']);
});

test('missing or malformed clocks do not imply a stalled feed', () => {
  assert.deepEqual(inspectClocks(), { stalled: false, repeatedCount: 0, unreliableIds: [], reportedClock: '', period: 0 });
  const result = inspectClocks([play('1', '14:99'), play('2', '14:99'), play('3', '14:99')], status('14:99'));
  assert.equal(result.stalled, false);
});

test('clock formatting is normalized for comparison without rewriting the reported value', () => {
  const result = inspectClocks([play('1', '01:20'), play('2', '1:20'), play('3', '01:20')], status('1:20'));
  assert.equal(result.stalled, true);
  assert.equal(result.reportedClock, '1:20');
});

test('inspection is pure and browser API matches Node API', () => {
  const before = JSON.stringify(fixture);
  inspectClocks(fixture.plays, fixture.status);
  assert.equal(JSON.stringify(fixture), before);
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/feed-health.js'), 'utf8'), context);
  assert.equal(context.window.FootballFeed.inspectClocks(fixture.plays, fixture.status).stalled, true);
});

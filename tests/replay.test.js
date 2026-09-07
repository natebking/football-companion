const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const replay = require('../web/replay.js');

const fixturePath = path.join(__dirname, '../web/replays/louisville-ole-miss-2026.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function flat(snapshot) {
  return snapshot.drives.previous.flatMap(drive => drive.plays);
}

function synthetic(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'football-replay',
    gameId: 'test-game',
    league: 'cfb',
    label: 'Away at Home',
    playedAt: '2026-09-01T00:00:00Z',
    sourceUrl: 'https://example.test/summary',
    retrievedAt: '2026-09-02T00:00:00Z',
    sourceStatus: 'final',
    sourceNote: 'Final reports may differ from reports released live.',
    season: { year: 2026, type: 2 },
    teams: [
      { id: 'home', homeAway: 'home', team: { id: 'home', displayName: 'Home', abbreviation: 'HOM', logos: [] } },
      { id: 'away', homeAway: 'away', team: { id: 'away', displayName: 'Away', abbreviation: 'AWY', logos: [] } }
    ],
    initialAfterPlayId: 'p1',
    momentSpecs: [{ label: 'Start', count: 0 }, { label: 'Final', afterPlayId: 'end' }],
    plays: [
      { id: 'p1', driveId: 'd1', type: { text: 'Rush' }, text: 'original report' },
      { id: 'p2', driveId: 'd1', type: { text: 'Pass Reception' }, text: 'second report', period: { number: 1 } },
      { id: 'p1', driveId: 'd1', type: { text: 'Rush' }, text: 'revised report' },
      { id: 'end', driveId: 'd2', type: { text: 'End of Game' }, text: 'End of game.',
        period: { number: 4 }, clock: { displayValue: '0:00' }, awayScore: 3, homeScore: 6 }
    ],
    ...overrides
  };
}

test('bundled data is a verified final-report stream without final totals outside play rows', () => {
  assert.equal(fixture.gameId, '401856661');
  assert.equal(fixture.label, 'Louisville at Ole Miss');
  assert.equal(fixture.playedAt, '2026-09-06T23:30Z');
  assert.equal(fixture.sourceStatus, 'final');
  assert.match(fixture.sourceUrl, /event=401856661/);
  assert.match(fixture.sourceNote, /Final ESPN play reports can differ/);
  assert.ok(fixture.plays.length >= 200);
  assert.equal(fixture.plays.at(-1).type.text, 'End of Game');
  assert.equal(new Set(fixture.plays.map(play => play.id)).size, fixture.plays.length);
  assert.ok(fixture.plays.every(play => play.driveId));
  assert.ok(!fixture.plays.some(play => play.id === '401856661720'), 'superseded live report is not merged into the final source');
  assert.ok(!('boxscore' in fixture) && !('leaders' in fixture));
  for (const team of fixture.teams) {
    assert.ok(!('score' in team) && !('linescores' in team) && !('statistics' in team));
  }
});

test('prepare exposes deterministic steps, viewer moments, and the useful post-punt starting point', () => {
  const model = replay.prepare(fixture);
  assert.equal(model.gameId, '401856661');
  assert.equal(model.league, 'cfb');
  assert.equal(model.plays.length, fixture.plays.length);
  assert.equal(model.steps[0], 0);
  assert.equal(model.steps.at(-1), model.plays.length, 'the terminal markers are included by the final step');
  assert.ok(model.steps.every((count, index) => index === 0 || count > model.steps[index - 1]));
  assert.equal(model.plays[model.initialCount - 1].id, '401856661687');
  assert.equal(model.plays[model.initialCount].id, '401856661693');
  assert.ok(model.steps.includes(model.initialCount));
  assert.deepEqual(model.moments.map(moment => moment.label), [
    'Start', 'Second half', 'Fourth quarter', 'A drive gets backed up', 'A new possession',
    'Yards after the catch', 'A costly penalty', 'Pressure on the quarterback', 'Final'
  ]);
  assert.equal(model.moments[0].count, 0);
  assert.equal(model.moments.at(-1).count, model.plays.length);
  assert.ok(model.moments.every(moment => model.steps.includes(moment.count)));
});

test('an initial snapshot contains exactly the released prefix and preserves possession boundaries', () => {
  const model = replay.prepare(fixture);
  const snap = replay.snapshot(model, model.initialCount);
  const reports = flat(snap);
  assert.deepEqual(reports.map(play => play.id), model.plays.slice(0, model.initialCount).map(play => play.id));
  assert.equal(reports.at(-1).id, '401856661687');
  assert.ok(!reports.some(play => play.id === '401856661693'));
  assert.equal(snap.drives.previous.at(-1).id, '40185666133');
  assert.deepEqual(snap.drives.previous.map(drive => drive.id),
    [...new Set(model.plays.slice(0, model.initialCount).map(play => play.driveId))]);
  const competition = snap.header.competitions[0];
  assert.equal(competition.status.type.state, 'in');
  assert.equal(competition.status.period, 4);
  assert.equal(competition.status.displayClock, '10:34');
  assert.equal(competition.competitors.find(team => team.homeAway === 'home').score, 31);
  assert.equal(competition.competitors.find(team => team.homeAway === 'away').score, 24);
});

test('the empty snapshot has no future score, clock, period, drive, or result', () => {
  const model = replay.prepare(fixture);
  const snap = replay.snapshot(model, 0), competition = snap.header.competitions[0];
  assert.deepEqual(snap.drives.previous, []);
  assert.equal(competition.status.type.state, 'pre');
  assert.equal(competition.status.type.completed, false);
  assert.ok(!('period' in competition.status));
  assert.ok(!('displayClock' in competition.status));
  assert.equal(competition.competitors.find(team => team.homeAway === 'home').score, null);
  assert.equal(competition.competitors.find(team => team.homeAway === 'away').score, null);
  assert.ok(!JSON.stringify(snap).includes('End of 4th quarter'));
});

test('half and quarter moments derive state only from included reports', () => {
  const model = replay.prepare(fixture);
  const halfEnd = model.plays.findIndex(play => play.type.text === 'End Period' && play.period?.number === 2) + 1;
  assert.ok(halfEnd > 0);
  const halftime = replay.snapshot(model, halfEnd).header.competitions[0].status;
  assert.equal(halftime.type.name, 'STATUS_HALFTIME');
  assert.equal(halftime.type.state, 'in');
  assert.equal(halftime.period, 2);
  assert.equal(halftime.displayClock, '0:00');

  const secondHalf = model.moments.find(moment => moment.label === 'Second half');
  const secondHalfReports = flat(replay.snapshot(model, secondHalf.count));
  assert.equal(secondHalfReports.at(-1).period.number, 3);
  assert.ok(!secondHalfReports.some(play => play.period && play.period.number === 4));
  const fourth = model.moments.find(moment => moment.label === 'Fourth quarter');
  assert.equal(flat(replay.snapshot(model, fourth.count)).at(-1).period.number, 4);
});

test('only the complete prefix is postgame and the final step carries terminal reports', () => {
  const model = replay.prepare(fixture);
  const before = replay.snapshot(model, model.plays.length - 1).header.competitions[0];
  const complete = replay.snapshot(model, model.plays.length).header.competitions[0];
  assert.equal(before.status.type.state, 'in');
  assert.equal(before.status.type.completed, false);
  assert.equal(complete.status.type.state, 'post');
  assert.equal(complete.status.type.name, 'STATUS_FINAL');
  assert.equal(complete.status.type.completed, true);
  assert.equal(flat(replay.snapshot(model, model.steps.at(-1))).at(-1).type.text, 'End of Game');
  assert.equal(complete.competitors.find(team => team.homeAway === 'home').score,
    model.plays.at(-1).homeScore);
});

test('deduplication keeps chronology, applies the latest report, and does not fill missing values from the future', () => {
  const model = replay.prepare(synthetic());
  assert.deepEqual(model.plays.map(play => play.id), ['p1', 'p2', 'end']);
  assert.equal(model.plays[0].text, 'revised report');
  assert.equal(model.initialCount, 1);
  const one = replay.snapshot(model, 1).header.competitions[0];
  assert.equal(one.status.type.state, 'in');
  assert.ok(!('period' in one.status));
  assert.ok(!('displayClock' in one.status));
  assert.equal(one.competitors.find(team => team.homeAway === 'home').score, null);
  assert.equal(one.competitors.find(team => team.homeAway === 'away').score, null);
  assert.equal(flat(replay.snapshot(model, 1))[0].text, 'revised report');
});

test('a newer missing clock stays unknown and an incomplete scoring update invalidates an older score', () => {
  const input = synthetic();
  input.initialAfterPlayId = 'missing';
  input.momentSpecs = [
    { label: 'Start', count: 0 },
    { label: 'Missing update', afterPlayId: 'missing' },
    { label: 'Final', afterPlayId: 'end' }
  ];
  input.plays = [
    { id: 'known', driveId: 'd1', type: { text: 'Rush' }, period: { number: 1 },
      clock: { displayValue: '8:00' }, awayScore: 0, homeScore: 3 },
    { id: 'missing', driveId: 'd1', type: { text: 'Field Goal Good' }, period: { number: 2 },
      scoringPlay: true },
    { id: 'restored', driveId: 'd2', type: { text: 'Kickoff' }, period: { number: 2 },
      clock: { displayValue: '7:50' }, awayScore: 3, homeScore: 3 },
    { id: 'end', driveId: 'd2', type: { text: 'End of Game' }, period: { number: 4 },
      clock: { displayValue: '0:00' }, awayScore: 3, homeScore: 6 }
  ];
  const model = replay.prepare(input);
  const missing = replay.snapshot(model, 2).header.competitions[0];
  assert.equal(missing.status.period, 2);
  assert.ok(!('displayClock' in missing.status), 'an earlier quarter clock is not carried into this report');
  assert.equal(missing.competitors.find(team => team.homeAway === 'home').score, null);
  assert.equal(missing.competitors.find(team => team.homeAway === 'away').score, null);
  const restored = replay.snapshot(model, 3).header.competitions[0];
  assert.equal(restored.status.displayClock, '7:50');
  assert.equal(restored.competitors.find(team => team.homeAway === 'home').score, 3);
  assert.equal(restored.competitors.find(team => team.homeAway === 'away').score, 3);
});

test('prepare fails clearly on incomplete data and snapshot rejects invalid counts', () => {
  assert.throws(() => replay.prepare(null), /data is unavailable/);
  assert.throws(() => replay.prepare(synthetic({ sourceStatus: 'live' })), /not a final summary/);
  assert.throws(() => replay.prepare(synthetic({ plays: [] })), /play reports are unavailable/);
  assert.throws(() => replay.prepare(synthetic({ plays: [{ id: 'p1', type: { text: 'Rush' } }] })), /drive id/);
  assert.throws(() => replay.prepare(synthetic({ plays: [{ id: 'p1', driveId: 'd', type: { text: 'Rush' } }] })), /terminal game report/);
  assert.throws(() => replay.prepare(synthetic({
    momentSpecs: [{ label: 'Start', count: 0 }, { label: 'Marker only', afterPlayId: 'pause' }, { label: 'Final', afterPlayId: 'end' }],
    plays: [
      { id: 'p1', driveId: 'd', type: { text: 'Rush' } },
      { id: 'pause', driveId: 'd', type: { text: 'Timeout' } },
      { id: 'end', driveId: 'd', type: { text: 'End of Game' } }
    ]
  })), /not an action step/);
  const model = replay.prepare(synthetic());
  for (const count of [-1, 0.5, model.plays.length + 1]) {
    assert.throws(() => replay.snapshot(model, count), RangeError);
  }
});

test('browser build exposes the same pure API without DOM access', () => {
  const source = fs.readFileSync(path.join(__dirname, '../web/replay.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  assert.equal(typeof context.window.FootballReplay.prepare, 'function');
  assert.equal(typeof context.window.FootballReplay.snapshot, 'function');
  const model = context.window.FootballReplay.prepare(JSON.parse(JSON.stringify(synthetic())));
  assert.equal(context.window.FootballReplay.snapshot(model, 0).header.competitions[0].status.type.state, 'pre');
});

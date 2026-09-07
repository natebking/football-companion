const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { summarize, forRead } = require('../web/game-insights.js');
const fixtures = require('./fixtures/play-facts.json');

const abbr = { '68': 'BOIS', '2483': 'ORE' };
function spot(ytg, down = 1, distance = 10, team = '68') {
  const side = team === '68' ? ['BOIS', 'ORE'] : ['ORE', 'BOIS'];
  return { team: { id: team }, down, distance, yardsToEndzone: ytg,
    possessionText: ytg === 50 ? '50' : (ytg > 50 ? side[0] + ' ' + (100 - ytg) : side[1] + ' ' + ytg) };
}
function run(id, from = 75, yards = 2, drive = 'drive-1') {
  return { id: String(id), driveId: drive, type: { text: 'Rush' },
    text: '#26 S.Gaines rush middle for ' + yards + ' yards gain', statYardage: yards,
    start: spot(from), end: spot(from - yards, yards >= 10 ? 1 : 2, yards >= 10 ? 10 : 10 - yards) };
}
function fromFixture(name, driveId = 'fixture-drive') {
  return Object.assign(structuredClone(fixtures[name].play), { driveId });
}
function inspect(plays, teamAbbreviations = abbr) { return summarize(plays, { teamAbbreviations }); }

// Compact source fields from ESPN game 401858433, drive 40185843332,
// captured 2026-09-05T22:26:42Z. Its drive metadata said "3 plays, 31 yards"
// and had an invalid ORE 0 starting spot. Only the individual reports are used.
function boiseDrive() {
  const driveId = '40185843332';
  return [
    { id: '401858433605', driveId, type: { text: 'Kickoff' },
      text: '#97 G.Hurych kickoff 65 yards to the BSU00, Touchback', statYardage: 0,
      start: spot(65, 1, 10, '2483'), end: spot(75) },
    { id: '401858433608', driveId, type: { text: 'Rush' },
      text: 'Shotgun #26 S.Gaines rush middle for 2 yards gain to the BSU27 (#6 J.Mixon; #10 M.Uiagalelei)', statYardage: 2,
      start: spot(75), end: spot(73, 2, 8) },
    { id: '401858433612', driveId, type: { text: 'Penalty' }, isPenalty: true,
      text: 'PENALTY ORE Offside (#10 M.Uiagalelei) 5 yards from BSU27 to BSU32. NO PLAY', statYardage: 5,
      start: spot(73, 2, 8), end: spot(68, 2, 3) },
    { id: '401858433615', driveId, type: { text: 'Penalty' }, isPenalty: true,
      text: 'Shotgun #4 M.Madsen pass incomplete deep to #19 R.Jones thrown to ORE29 QB hurried by #1 B.Alexander PENALTY ORE Pass Interference (#21 A.Flowers) 15 yards from BSU32 to BSU47, 1ST DOWN. NO PLAY', statYardage: 15,
      start: spot(68, 2, 3), end: spot(53) },
    { id: '401858433619', driveId, type: { text: 'Rush' },
      text: '#0 D.Riley rush middle for 4 yards gain to the ORE49 (#3 K.Perich; #21 A.Flowers)', statYardage: 4,
      start: spot(53), end: spot(49, 2, 6) },
    { id: '401858433623', driveId, type: { text: 'Pass Reception' },
      text: '#4 M.Madsen pass complete short right to #88 M.Wagner caught at ORE48, for 5 yards to the ORE44 (#3 K.Perich)', statYardage: 5,
      start: spot(49, 2, 6), end: spot(44, 3, 1) }
  ];
}

test('a real drive separates 11 play yards from 20 penalty yards', () => {
  const result = inspect(boiseDrive());
  assert.equal(result.drive.team, 'BOIS');
  assert.equal(result.drive.id, '40185843332');
  assert.equal(result.drive.verified, true);
  assert.equal(result.drive.complete, false);
  assert.equal(result.drive.playCount, 3);
  assert.equal(result.drive.netYards, 31);
  assert.equal(result.drive.playYards, 11);
  assert.equal(result.drive.penaltyYards, 20);
  assert.deepEqual(result.drive.progress.map(p => [p.from, p.to, p.kind]), [
    [25, 27, 'play'], [27, 32, 'penalty'], [32, 47, 'penalty'], [47, 51, 'play'], [51, 56, 'play']
  ]);
  assert.match(result.drive.summary, /11 yards gained on plays; penalties moved the ball 20 yards forward/);
  assert.equal(result.teams.length, 1);
  assert.deepEqual(result.teams[0].earlyDowns, { runs: 2, passes: 1, sacks: 0, total: 3 });
  assert.deepEqual(result.teams[0].receivers, [{ name: '#88 M.Wagner', targets: 1, catches: 1, yards: 5,
    playIds: ['401858433623'] }]);
});

test('repeated IDs from current/previous drives never double the totals', () => {
  const plays = boiseDrive();
  const result = inspect(plays.concat(structuredClone(plays)));
  assert.equal(result.coverage.uniqueReports, 6);
  assert.equal(result.drive.netYards, 31);
  assert.equal(result.teams[0].coverage.observedPlays, 3);
});

test('same-ID corrections replace yardage, names and directions at their original position', () => {
  const original = run('one');
  const corrected = run('one', 75, 5);
  corrected.text = '#0 D.Riley rush right for 5 yards gain';
  const before = inspect([original]);
  const after = inspect([original, corrected]);
  assert.equal(before.drive.netYards, 2);
  assert.equal(after.drive.netYards, 5);
  assert.equal(after.drive.playCount, 1);
  assert.deepEqual(after.teams[0].runners, [{ name: '#0 D.Riley', carries: 1, yards: 5, playIds: ['one'] }]);
  assert.deepEqual(after.teams[0].directions.run, { left: 0, middle: 0, right: 1, known: 1, total: 1 });
});

test('all released reports count beyond the visible 25-play feed', () => {
  const plays = Array.from({ length: 40 }, (_, i) => run(i, 75, 2, 'drive-' + i));
  const result = inspect(plays);
  assert.equal(result.teams[0].earlyDowns.runs, 40);
  assert.equal(result.teams[0].runners[0].carries, 40);
  assert.equal(result.drive.id, 'drive-39');
});

test('clock placeholders do not affect movement or observable counts', () => {
  const plays = boiseDrive();
  plays.forEach(p => { p.clock = { displayValue: '14:49' }; p.period = { number: 4 }; });
  assert.equal(inspect(plays).drive.netYards, 31);
});

test('a combined run and penalty yields separate field segments', () => {
  const result = inspect([fromFixture('runWithPenalty')], fixtures.runWithPenalty.abbr);
  assert.equal(result.drive.netYards, -4);
  assert.equal(result.drive.playYards, 6);
  assert.equal(result.drive.penaltyYards, -10);
  assert.equal(result.drive.playCount, 1);
  assert.deepEqual(result.drive.progress.map(p => [p.from, p.to, p.kind]), [[43, 49, 'play'], [49, 39, 'penalty']]);
  assert.equal(result.teams.length, 0); // Accepted penalties do not enter tendencies/player counts.
});

test('unknown enforcement prevents a partial yardage sum from becoming a drive total', () => {
  const plays = boiseDrive();
  plays[2].text = 'PENALTY ORE Offside. NO PLAY';
  const result = inspect(plays);
  assert.equal(result.drive.verified, false);
  assert.equal(result.drive.netYards, null);
  assert.equal(result.drive.playYards, null);
  assert.equal(result.drive.penaltyYards, null);
  assert.equal(result.drive.coverage.unverifiedReports, 1);
  assert.match(result.drive.summary, /do not support a complete yardage total/);
});

test('a discontinuity in field position makes drive totals unavailable', () => {
  const result = inspect([run('1', 75, 2), run('2', 65, 4)]);
  assert.equal(result.drive.verified, false);
  assert.equal(result.drive.netYards, null);
  assert.equal(result.drive.progress.length, 2); // Individually valid segments remain separate.
});

test('a first available row on second down is not assumed to be a whole drive', () => {
  const p = run('partial'); p.start.down = 2; p.end.down = 3;
  assert.equal(inspect([p]).drive.netYards, null);
});

test('exact mirrored spots are repaired; other contradictions do not create movement', () => {
  const p = run('mirror'); p.end.yardsToEndzone = 27;
  assert.equal(inspect([p]).drive.netYards, 2);
  p.end.yardsToEndzone = 70;
  assert.equal(inspect([p]).drive.netYards, null);
  assert.equal(inspect([p]).drive.progress.length, 0);
});

test('turnovers never turn return yards into offensive drive or player yards', () => {
  for (const name of ['interception', 'fumbleLost', 'fourthDown']) {
    const result = inspect([fromFixture(name)], fixtures[name].abbr);
    assert.equal(result.drive.complete, true, name);
    assert.equal(result.drive.netYards, null, name);
    assert.equal(result.drive.progress.length, 0, name);
    for (const team of result.teams) {
      for (const p of team.receivers) if (p.catches) assert.equal(p.yards, null, name);
      for (const p of team.runners) assert.equal(p.yards, null, name);
    }
  }
});

test('sacks are separate from throws and can reduce verified drive yards', () => {
  const p = fromFixture('sack'); p.start.down = 1; p.end.down = 2;
  const result = inspect([p], fixtures.sack.abbr);
  assert.deepEqual(result.teams[0].earlyDowns, { runs: 0, passes: 0, sacks: 1, total: 1 });
  assert.equal(result.drive.playYards, -5);
  assert.equal(result.teams[0].directions.pass.total, 0);
});

test('a touchdown and bundled conversion count as one offensive play', () => {
  const result = inspect([fromFixture('touchdownWithConversionPenalty')], fixtures.touchdownWithConversionPenalty.abbr);
  assert.equal(result.drive.complete, true);
  assert.equal(result.drive.netYards, null); // This real excerpt begins on second down.
  assert.equal(result.drive.progress[0].to, 100);
  assert.equal(result.drive.playCount, 1);
  assert.equal(result.teams[0].earlyDowns.runs, 1);
});

test('kickoffs, conversions, markers, knees and spikes do not inflate run/throw patterns', () => {
  const plays = [run('normal')];
  for (const [id, type, text] of [
    ['kick', 'Kickoff', 'Kickoff'], ['pat', 'Extra Point Good', 'Extra Point Good'],
    ['two', 'Two Point Pass', 'Two-point attempt'], ['time', 'Timeout', 'Timeout'],
    ['knee', 'Rush', 'Kneel down by #4 M.Madsen for 1 yard loss'],
    ['spike', 'Pass Incompletion', 'Quarterback spikes the ball'], ['end', 'End Game', 'End Game']
  ]) plays.push({ id, type: { text: type }, text, start: spot(73), end: spot(73) });
  const result = inspect(plays);
  assert.equal(result.teams[0].coverage.observedPlays, 1);
  assert.equal(result.teams[0].earlyDowns.total, 1);
});

test('a punt ends the drive without adding kick distance to offensive yards', () => {
  const p = run('1');
  const punt = { id: 'punt', driveId: p.driveId, type: { text: 'Punt' }, text: 'Punt for 50 yards', statYardage: 50,
    start: spot(73, 4, 8), end: spot(77, 1, 10, '2483') };
  let result = inspect([p, punt]);
  assert.equal(result.drive.netYards, 2);
  assert.equal(result.drive.complete, true);
  assert.equal(result.drive.playCount, 1);
  assert.match(result.drive.summary, /Ended with a punt/);
  punt.start = spot(63, 4, 8); // An unreported 10 yards cannot be silently skipped.
  result = inspect([p, punt]);
  assert.equal(result.drive.netYards, null);
});

test('an incomplete target adds no catch or receiving yards and missing names lower coverage', () => {
  const pass = { id: 'pass', type: { text: 'Pass Incompletion' }, statYardage: 0,
    text: '#4 M.Madsen pass incomplete short right to #88 M.Wagner', start: spot(75), end: spot(75, 2, 10) };
  const unknown = structuredClone(pass); unknown.id = 'unknown'; unknown.text = 'Pass incomplete.';
  const team = inspect([pass, unknown]).teams[0];
  assert.deepEqual(team.receivers, [{ name: '#88 M.Wagner', targets: 1, catches: 0, yards: 0, playIds: ['pass'] }]);
  assert.equal(team.coverage.namedTargets, 1);
  assert.equal(team.coverage.passes, 2);
  assert.equal(team.directions.pass.known, 1);
  assert.equal(team.directions.pass.total, 2);
  assert.match(team.summaries.join(' '), /0 catches/);
});

test('an unresolved kick or a blocked punt retained by the offense does not prove the drive ended', () => {
  const p = run('1');
  for (const [type, text] of [['Field Goal', 'Field goal attempt'], ['Blocked Punt', 'Punt blocked and recovered by the offense']]) {
    const kick = { id: 'kick', driveId: p.driveId, type: { text: type }, text,
      start: spot(73, 4, 8), end: spot(73, 1, 10) };
    assert.equal(inspect([p, kick]).drive.complete, false);
  }
});

test('a named runner with one unverified gain has no fabricated total yardage', () => {
  const known = run('known'), unknown = run('unknown');
  unknown.statYardage = 0; delete unknown.end;
  const team = inspect([known, unknown]).teams[0];
  assert.equal(team.earlyDowns.runs, 2); // The reported action is still an actual run.
  assert.equal(team.runners[0].carries, 2);
  assert.equal(team.runners[0].yards, null);
  assert.equal(team.coverage.verifiedYardage, 1);
  assert.match(team.summaries.join(' '), /2 reported carries\. Yardage is incomplete\./);
});

test('the read whitelist keeps action, player, coverage and support scopes separate', () => {
  const result = forRead(inspect(boiseDrive()), 'game-123');
  const team = result.teams[0], drive = result.drive;
  assert.equal(result.gameId, 'game-123');
  assert.deepEqual({ runs: team.actions.runs, passes: team.actions.passes, sacks: team.actions.sacks,
    dropbacks: team.actions.dropbacks }, { runs: 2, passes: 1, sacks: 0, dropbacks: 1 });
  assert.deepEqual(team.coverage, { passes: 1, namedTargets: 1, runs: 2, namedCarries: 2 });
  assert.deepEqual(team.receivers[0], { name: '#88 M.Wagner', targets: 1, playIds: ['401858433623'] });
  assert.deepEqual(drive.actions.passPlayIds, ['401858433623']);
  assert.deepEqual(drive.actions.runPlayIds, ['401858433608', '401858433619']);
  assert.equal(drive.teamId, '68');
  assert.doesNotMatch(JSON.stringify(result), /pass complete|yardsToEndzone|statYardage/);
});

test('sacks count as dropbacks without becoming throws or named-target opportunities', () => {
  const sack = fromFixture('sack'); sack.start.down = 1; sack.end.down = 2;
  const pass = { id: 'throw', driveId: sack.driveId, type: { text: 'Pass Incompletion' }, statYardage: 0,
    text: '#4 M.Madsen pass incomplete short right to #88 M.Wagner', start: sack.end, end: spot(70, 3, 8) };
  const team = forRead(inspect([sack, pass], fixtures.sack.abbr), 'game').teams[0];
  assert.equal(team.actions.dropbacks, 2);
  assert.equal(team.actions.sacks, 1);
  assert.equal(team.actions.passes, 1);
  assert.equal(team.coverage.namedTargets, 1);
  assert.deepEqual(team.actions.passPlayIds, ['throw']);
});

test('a penalty correction removes the former run from every count', () => {
  const p = run('changed');
  const penalty = structuredClone(p);
  penalty.text = 'PENALTY BOIS False Start 5 yards from BSU25 to BSU20. NO PLAY';
  penalty.type.text = 'Penalty'; penalty.isPenalty = true; penalty.end = spot(80, 1, 15);
  const result = inspect([p, penalty]);
  assert.equal(result.teams.length, 0);
  assert.equal(result.drive.playCount, 0);
  assert.equal(result.drive.netYards, -5);
});

test('missing drive IDs or play IDs stay explicit rather than creating guessed drives', () => {
  const p = run('known'); delete p.driveId;
  const result = inspect([p, { text: 'Unidentified report' }, null]);
  assert.equal(result.drive, null);
  assert.equal(result.coverage.unidentifiedReports, 2);
  assert.equal(result.coverage.uniqueReports, 1);
  assert.equal(result.coverage.reportsWithDrive, 0);
  assert.deepEqual(summarize().teams, []);
});

test('recomputation is deterministic and does not mutate source reports', () => {
  const plays = boiseDrive(), before = JSON.stringify(plays);
  assert.deepEqual(inspect(plays), inspect(plays));
  assert.equal(JSON.stringify(plays), before);
});

test('browser scripts expose the same pure insights API', () => {
  const context = { window: {} };
  for (const path of ['../web/play-facts.js', '../web/game-insights.js']) {
    vm.runInNewContext(fs.readFileSync(require.resolve(path), 'utf8'), context);
  }
  const result = context.window.FootballInsights.summarize(boiseDrive(), { teamAbbreviations: abbr });
  assert.equal(result.drive.netYards, 31);
});

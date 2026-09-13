const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { describe } = require('../web/play-facts.js');
const fixtures = require('./fixtures/play-facts.json');

function fixture(name) {
  const f = fixtures[name];
  return describe(f.play, f.abbr);
}
function copy(name) { return structuredClone(fixtures[name]); }

// Reports inspected in the September 6 Louisville–Ole Miss live audit.
function auditedPlay(id) {
  const abbr = { '145': 'MISS', '97': 'LOU' };
  const plays = {
    '693': {
      id: '401856661693', type: { text: 'Pass Reception' },
      text: 'No Huddle-Shotgun #6 T.Chambliss pass complete short right to #26 J.Lindsey caught at Miss41, for 4 yards to the Miss50 (#11 T.Capers)',
      statYardage: 4,
      start: { down: 1, distance: 10, yardsToEndzone: 54, possessionText: 'MISS 46', team: { id: '145' } },
      end: { down: 2, distance: 6, yardsToEndzone: 50, possessionText: '50', team: { id: '145' } }
    },
    '709': {
      id: '401856661709', type: { text: 'Pass Reception' },
      text: 'No Huddle-Shotgun #6 T.Chambliss pass complete short left to #11 H.Fields caught at Lou48, for 14 yards to the Lou40 (#4 T.Banks; #11 T.Capers)',
      statYardage: 14,
      start: { down: 1, distance: 25, yardsToEndzone: 54, possessionText: 'MISS 46', team: { id: '145' } },
      end: { down: 2, distance: 11, yardsToEndzone: 40, possessionText: 'LOU 40', team: { id: '145' } }
    },
    '714': {
      id: '401856661714', type: { text: 'Pass Incompletion' },
      text: 'No Huddle-Shotgun #6 T.Chambliss pass incomplete deep right thrown to Lou20 QB hurried by #4 T.Banks',
      statYardage: 0,
      start: { down: 2, distance: 11, yardsToEndzone: 40, possessionText: 'LOU 40', team: { id: '145' } },
      end: { down: 3, distance: 11, yardsToEndzone: 40, possessionText: 'LOU 40', team: { id: '145' } }
    },
    '720': {
      id: '401856661720', type: { text: 'Penalty' }, isPenalty: true,
      text: '#17 L.Carneiro field goal attempt from 57 yards NO GOOD (H: #33 O.Bird, LS: #50 C.Blankenship), clock 00:00, End Of Play PENALTY Lou Roughing The Kicker (#12 D.Waller) 15 yards from Lou40 to Lou25, 1ST DOWN. NO PLAY',
      statYardage: 15,
      start: { down: 4, distance: 11, yardsToEndzone: 40, possessionText: 'LOU 40', team: { id: '145' } },
      end: { down: 1, distance: 10, yardsToEndzone: 25, possessionText: 'LOU 25', team: { id: '145' } }
    }
  };
  return { play: structuredClone(plays[id]), abbr };
}

test('ordinary run: gives the next down and explicit direction', () => {
  const p = fixture('normalRun');
  assert.equal(p.summary, 'Run for 4 yards.');
  assert.equal(p.consequence, 'Next: 2nd & 6 at OSU 20.');
  assert.deepEqual(p.facts, ['Run through the middle']);
  assert.equal(p.players, '#25 B.Jackson');
  assert.equal(p.outcome, 'run');
  assert.equal(p.gained, 4);
  assert.equal(p.need, 10);
});

test('a defender named Kneeland cannot turn a run into taking a knee', () => {
  const f = copy('normalRun');
  f.play.text = f.play.text + ' Tackled by M.Kneeland.';
  const result = describe(f.play, f.abbr);
  assert.equal(result.outcome, 'run');
  assert.equal(result.gained, 4);
  const insights = require('../web/game-insights.js').summarize([f.play], { teamAbbreviations: f.abbr });
  assert.equal(insights.teams[0].earlyDowns.runs, 1);
});

test('a fake kneel remains an actual run', () => {
  const f = copy('normalRun');
  f.play.text += ' Fake kneel by QB.';
  assert.equal(describe(f.play, f.abbr).outcome, 'run');
  assert.equal(describe(f.play, f.abbr).clockPlay, false);
});

test('pass details preserve named players, short depth, and direction', () => {
  const p = fixture('normalPass');
  assert.equal(p.summary, 'Pass complete for 12 yards.');
  assert.equal(p.consequence, 'Next: 1st & 10 at OSU 49.');
  assert.deepEqual(p.facts, ['Shotgun', 'Short pass over the middle']);
  assert.equal(p.players, '#6 K.Luster to #10 J.McDougle');
  assert.equal(p.outcome, 'pass');
  assert.equal(p.raw, fixtures.normalPass.play.text);
});

test('legacy feed supplies names without inventing direction or formation', () => {
  const p = fixture('legacyPass');
  assert.equal(p.players, 'Keelon Russell to Daniel Hill');
  assert.deepEqual(p.facts, []);
});

test('failed fourth down is a turnover even when ESPN isTurnover is false', () => {
  assert.equal(fixtures.fourthDown.play.isTurnover, false);
  const p = fixture('fourthDown');
  assert.equal(p.outcome, 'pass');
  assert.equal(p.turnover, true);
  assert.equal(p.kind, 'turn');
  assert.equal(p.consequence, 'Turnover on downs. OSU takes possession.');
  assert.equal(p.gained, null);
});

test('interception return yardage is never offered as offensive progress', () => {
  assert.equal(fixtures.interception.play.statYardage, 31);
  const p = fixture('interception');
  assert.equal(p.outcome, 'pass');
  assert.equal(p.turnover, true);
  assert.equal(p.gained, null);
  assert.equal(p.need, null);
  assert.equal(p.consequence, 'IU takes possession.');
  assert.doesNotMatch(p.summary, /31/);
});

test('lost fumble retains explicit run identity and possession outcome', () => {
  const p = fixture('fumbleLost');
  assert.equal(p.outcome, 'run');
  assert.equal(p.turnover, true);
  assert.equal(p.consequence, 'ORST takes possession.');
  assert.equal(p.gained, null);
});

test('sacks are neither a thrown pass nor an actual run for grading', () => {
  const p = fixture('sack');
  assert.equal(p.outcome, 'other');
  assert.equal(p.voidReason, 'The quarterback was sacked before throwing. Your pick does not count.');
  assert.equal(p.gained, null);
  assert.match(p.consequence, /Loss of 5 yards/);
});

test('a scramble is an actual run, even if the data type says pass', () => {
  const f = copy('normalRun');
  f.play.type.text = 'Pass';
  f.play.text = '#10 J.Sayin scrambled for 4 yards';
  const p = describe(f.play, f.abbr);
  assert.equal(p.outcome, 'run');
  assert.equal(p.summary, 'Quarterback scramble for 4 yards.');
});

test('accepted penalties stay ungraded while validated advancement explains the ruling', () => {
  for (const name of ['penalty', 'runWithPenalty', 'automaticFirstDown']) {
    const p = fixture(name);
    assert.equal(p.outcome, 'other', name);
    assert.equal(p.gained, null, name);
    assert.equal(p.need, null, name);
    assert.equal(p.voidReason, 'A penalty affected this play, so your pick does not count.', name);
    assert.ok(p.movement, name);
  }
  assert.equal(fixture('penalty').consequence, 'The penalty moved the ball 5 yards back. Next: 1st & 15 at BALL 20.');
  assert.equal(fixture('runWithPenalty').consequence, '6 yards gained on the play, then 10 yards back for the penalty. Next: 2nd & 14 at NEB 39.');
  assert.equal(fixture('automaticFirstDown').consequence, '8 yards gained on the play, then 15 yards forward for the penalty. First down.');
});

test('a declined penalty preserves the play and its reported facts', () => {
  const p = fixture('declinedPenalty');
  assert.equal(p.outcome, 'pass');
  assert.equal(p.voidReason, null);
  assert.equal(p.gained, 25);
  assert.ok(p.facts.includes('Penalty declined'));
});

test('live zero-yard statistic is repaired only when report and field movement agree', () => {
  const f = fixtures.liveZeroYardage;
  assert.equal(f.play.statYardage, 0);
  const p = fixture('liveZeroYardage');
  assert.equal(p.summary, 'Run for 5 yards.');
  assert.equal(p.consequence, 'Next: 2nd & 5 at TNST 30.');
  assert.equal(p.gained, 5);
  assert.equal(p.need, 10);
  assert.equal(p.voidReason, null);
});

test('contradictory yardage without corroborating field movement is not graded', () => {
  const f = copy('liveZeroYardage');
  delete f.play.end;
  const p = describe(f.play, f.abbr);
  assert.equal(p.summary, 'Run.');
  assert.equal(p.gained, null);
  assert.equal(p.need, null);
  assert.match(p.voidReason, /yardage is inconsistent/);
  assert.equal(p.consequence, 'ESPN reports conflicting yardage. See the play report.');
});

test('a disagreement with the field spot does not print a contradictory next situation', () => {
  const f = copy('liveZeroYardage');
  f.play.statYardage = 5;
  f.play.end.yardsToEndzone = 66;
  f.play.end.possessionText = 'TNST 34';
  const p = describe(f.play, f.abbr);
  assert.equal(p.summary, 'Run for 5 yards.');
  assert.equal(p.gained, null);
  assert.match(p.voidReason, /yardage is inconsistent/);
  assert.doesNotMatch(p.consequence, /Next:/);
});

test('declined live penalty preserves the sack despite Penalty type and isPenalty flag', () => {
  const f = fixtures.liveDeclinedSack;
  assert.equal(f.play.isPenalty, true);
  assert.equal(f.play.type.text, 'Penalty');
  const p = fixture('liveDeclinedSack');
  assert.equal(p.summary, 'Sack. The quarterback was tackled before throwing.');
  assert.equal(p.consequence, 'Loss of 10 yards.'); // Feed incorrectly leaves the down at third.
  assert.ok(p.facts.includes('Penalty declined'));
  assert.equal(p.outcome, 'other');
  assert.equal(p.gained, null);
  assert.match(p.voidReason, /sacked/);
});

test('nullified touchdowns cannot become a score or a routine gain', () => {
  const p = fixture('nullifiedTouchdown');
  assert.equal(p.summary, 'Touchdown called back by a penalty.');
  assert.equal(p.kind, '');
  assert.equal(p.outcome, 'other');
  assert.equal(p.gained, null);
});

test('conversion penalty does not cancel a touchdown bundled in the same row', () => {
  const p = fixture('touchdownWithConversionPenalty');
  assert.equal(p.summary, '1-yard touchdown run.');
  assert.equal(p.consequence, 'Six points. Extra point good.');
  assert.equal(p.kind, 'score');
  assert.equal(p.outcome, 'run');
  assert.equal(p.voidReason, null);
  assert.doesNotMatch(p.facts.join(' '), /pass|penalty/i);
});

test('touchdown scoring metadata works even when type remains Pass Reception', () => {
  const f = copy('touchdownPass');
  f.play.type.text = 'Pass Reception';
  const p = describe(f.play, f.abbr);
  assert.equal(p.summary, '48-yard touchdown pass.');
  assert.equal(p.kind, 'score');
  assert.equal(p.consequence, 'Six points. Extra point good.');
});

test('scoring flags do not turn field goals, safeties, and extra points into TDs', () => {
  for (const [type, points] of [['Field Goal Good', 'Three points.'], ['Safety', 'Two points to the defense.'], ['Extra Point Good', 'One point.']]) {
    const p = describe({ type: { text: type }, scoringPlay: true, text: type });
    assert.equal(p.kind, 'score');
    assert.equal(p.consequence, points);
    assert.doesNotMatch(p.summary, /touchdown/i);
  }
});

test('kick returns and two-point attempts have their own scoring descriptions', () => {
  const kick = describe({ type: { text: 'Kickoff Return Touchdown' }, scoringPlay: true });
  assert.equal(kick.summary, 'Kickoff returned for a touchdown.');
  assert.equal(kick.outcome, 'kick');
  const two = describe({ type: { text: 'Two Point Pass' }, scoringPlay: true, scoreValue: 2 });
  assert.equal(two.summary, 'Two-point conversion good.');
  assert.equal(two.consequence, 'Two points.');
  assert.equal(two.outcome, 'other');
});

test('No Good kicks never count as made, including conflicting scoring metadata', () => {
  for (const [type, scoring, summary] of [
    ['Field Goal No Good', 'field-goal', 'Field goal missed.'],
    ['Extra Point No Good', 'extra-point', 'Extra point unsuccessful.'],
    ['Field Goal Blocked', 'field-goal', 'Field goal blocked.']
  ]) {
    const p = describe({ type: { text: type }, text: type, scoringType: { name: scoring }, scoringPlay: true });
    assert.equal(p.summary, summary);
    assert.equal(p.kind, '');
    assert.equal(p.consequence, '');
  }
  const contradictory = describe({ type: { text: 'Field Goal Good' }, text: '45-yard field goal is NO GOOD.' });
  assert.equal(contradictory.summary, 'Field goal missed.');
  assert.equal(contradictory.kind, '');
});

test('a kick without a reported result is an attempt, not an assumed miss', () => {
  assert.equal(describe({ type: { text: 'Field Goal' } }).summary, 'Field goal attempt.');
  assert.equal(describe({ type: { text: 'Extra Point' } }).summary, 'Extra point attempt.');
});

test('mirrored end-zone yardage can be repaired from a known reported spot', () => {
  const f = copy('normalRun');
  f.play.end.yardsToEndzone = 20; // OSU offense is at its own 20, so 80 to go.
  assert.equal(describe(f.play, f.abbr).consequence, 'Next: 2nd & 6 at OSU 20.');
  f.play.end.yardsToEndzone = 77; // A non-mirror contradiction is not repaired.
  assert.equal(describe(f.play, f.abbr).consequence, '');
});

test('goal-line distance zero is normalized without printing a first down', () => {
  const p = describe({
    type: { text: 'Rush' }, text: '#1 A.Runner rush middle for 1 yard', statYardage: 1,
    start: { down: 1, distance: 0, yardsToEndzone: 3, possessionText: 'DEF 3', team: { id: '1' } },
    end: { down: 2, distance: 0, yardsToEndzone: 2, possessionText: 'DEF 2', shortDownDistanceText: '2nd & Goal', team: { id: '1' } }
  }, { '1': 'OFF', '2': 'DEF' });
  assert.equal(p.need, 3);
  assert.equal(p.consequence, 'Next: 2nd & goal at DEF 2.');
  assert.equal(p.meaning, 'The ball is now 2 yards from the end zone.');
});

test('negative end distances never produce a made-up next down', () => {
  const f = copy('normalRun');
  f.play.end.distance = -3;
  assert.equal(describe(f.play, f.abbr).consequence, '');
});

test('markers, kneels, and spikes are never guessed to be run or pass', () => {
  for (const [type, text] of [['Timeout', 'Timeout'], ['End Period', 'End Period'], ['Rush', 'Kneel down by #6 K.Luster'], ['Pass Incompletion', 'Quarterback spikes the ball']]) {
    const p = describe({ type: { text: type }, text });
    assert.equal(p.outcome, 'other');
    assert.ok(p.voidReason);
    assert.equal(p.gained, null);
  }
});

test('missing optional fields preserve the source without invented facts', () => {
  const p = describe({ text: 'Unrecognized feed format.' });
  assert.equal(p.raw, 'Unrecognized feed format.');
  assert.deepEqual(p.facts, []);
  assert.equal(p.players, '');
  assert.equal(p.consequence, '');
  assert.equal(p.gained, null);
  assert.equal(p.need, null);
  assert.equal(describe().outcome, 'other');
});

test('describing a play does not mutate the feed record', () => {
  const f = copy('normalPass');
  const before = JSON.stringify(f);
  describe(f.play, f.abbr);
  assert.equal(JSON.stringify(f), before);
});

test('browser entry point exposes the same pure describe API', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/play-facts.js'), 'utf8'), context);
  assert.equal(typeof context.window.FootballPlay.describe, 'function');
  assert.equal(context.window.FootballPlay.describe(fixtures.normalRun.play).outcome, 'run');
});

test('reported catch spots separate the throw from yards after the catch', () => {
  const p = fixture('normalPass');
  assert.equal(p.airYards, 11);
  assert.equal(p.yardsAfterCatch, 1);
  assert.equal(p.depthSource, 'reported spots');
  assert.equal(p.depthText, 'Caught 11 yards beyond the line of scrimmage; 1 yard after the catch.');
  assert.deepEqual(p.people, { passer: '#6 K.Luster', receiver: '#10 J.McDougle', runner: '' });
  assert.deepEqual(p.movement, { start: 61, end: 49, net: 12, play: 12, penalty: 0 });
});

test('an explicit end-zone catch and matching prose alias support touchdown depth', () => {
  const p = fixture('touchdownPass');
  assert.equal(p.airYards, 48);
  assert.equal(p.yardsAfterCatch, 0);
  assert.equal(p.movement.end, 0);
  assert.equal(p.depthSource, 'reported spots');
});

test('unmapped catch-side aliases are not guessed from short or deep labels', () => {
  const f = copy('normalPass');
  f.play.text = f.play.text.replace('BallSt50', 'Unknown42');
  const p = describe(f.play, f.abbr);
  assert.equal(p.airYards, null);
  assert.equal(p.yardsAfterCatch, null);
  assert.equal(p.depthText, '');
  assert.ok(p.facts.includes('Short pass over the middle'));
});

test('a behind-the-line catch can have more after-catch yards than the total gain', () => {
  const f = copy('normalPass');
  f.play.text = f.play.text.replace('BallSt50', 'BALL36'); // Started at own 39.
  const p = describe(f.play, f.abbr);
  assert.equal(p.airYards, -3);
  assert.equal(p.yardsAfterCatch, 15);
  assert.equal(p.depthText, 'Caught 3 yards behind the line of scrimmage; 15 yards after the catch.');
});

test('the real Jackson to Flowers 36-yard play is 3 air yards plus 33 after the catch', () => {
  // nflverse data/raw/nfl_pbp_2025.parquet, game 2025_01_BAL_BUF, play 2796.
  const p = describe({ id: '2025_01_BAL_BUF:2796', type: { text: 'Pass Reception' },
    text: '(2:42) 8-L.Jackson pass short right to 4-Z.Flowers pushed ob at BUF 32 for 36 yards (C.Bishop).',
    statYardage: 36, complete_pass: 1, air_yards: 3, yards_after_catch: 33 });
  assert.equal(p.gained, 36);
  assert.equal(p.airYards, 3);
  assert.equal(p.yardsAfterCatch, 33);
  assert.equal(p.depthSource, 'reported');
});

test('structured catch data must reconcile and cannot override a contradictory live result', () => {
  for (const [air, after] of [[3, 8], ['3', 9], [3, null], [100, -88]]) {
    const f = copy('normalPass');
    f.play.airYards = air; f.play.yardsAfterCatch = after;
    assert.equal(describe(f.play, f.abbr).depthText, '');
  }
  const f = copy('normalPass');
  f.play.airYards = 3; f.play.yardsAfterCatch = 9;
  assert.equal(describe(f.play, f.abbr).airYards, null); // The explicit catch spot says 11 + 1.
  f.play.text = f.play.text.replace('caught at BallSt50, ', '');
  assert.equal(describe(f.play, f.abbr).airYards, 3);
  f.play.end.yardsToEndzone = 47; f.play.end.possessionText = 'OSU 47';
  assert.equal(describe(f.play, f.abbr).depthText, '');
});

test('nullable optional fields do not erase an independently reported catch spot', () => {
  const f = copy('normalPass'); f.play.airYards = null; f.play.yardsAfterCatch = null;
  const p = describe(f.play, f.abbr);
  assert.equal(p.airYards, 11);
  assert.equal(p.yardsAfterCatch, 1);
  assert.equal(p.depthSource, 'reported spots');
});

test('turnovers, penalties and incomplete passes do not acquire catch-yardage claims', () => {
  for (const name of ['interception', 'fourthDown', 'nullifiedTouchdown', 'runWithPenalty']) {
    const f = copy(name); f.play.airYards = 3; f.play.yardsAfterCatch = 4;
    const p = describe(f.play, f.abbr);
    assert.equal(p.depthText, '', name);
    if (name !== 'runWithPenalty') assert.equal(p.movement, null, name);
  }
  const f = copy('normalPass');
  f.play.text = f.play.text.replace('pass complete', 'pass incomplete');
  assert.equal(describe(f.play, f.abbr).depthText, '');
});

test('penalty movement must reconcile with the enforcement and cannot make up missing yards', () => {
  const f = copy('runWithPenalty');
  assert.deepEqual(describe(f.play, f.abbr).movement, { start: 57, end: 61, net: -4, play: 6, penalty: -10 });
  f.play.text = f.play.text.replace('10 yards from', '15 yards from');
  let p = describe(f.play, f.abbr);
  assert.equal(p.movement, null);
  assert.equal(p.consequence, 'See the play report for the ruling.');
  f.play.text = f.play.text.replace('15 yards from', '10 yards from');
  delete f.play.end;
  p = describe(f.play, f.abbr);
  assert.equal(p.movement, null);
  assert.equal(p.consequence, 'See the play report for the ruling.');
});

test('a no-play penalty cannot advance the down without a reported first down', () => {
  const f = copy('penalty'); f.play.end.down = 2;
  const p = describe(f.play, f.abbr);
  assert.equal(p.consequence, 'The penalty moved the ball 5 yards back.');
  assert.equal(p.meaning, 'The penalty changed the spot. The play itself does not count.');
});

test('sacks and knees can contribute verified drive movement while staying ungraded', () => {
  assert.deepEqual(fixture('sack').movement, { start: 58, end: 63, net: -5, play: -5, penalty: 0 });
  const f = copy('normalRun'); f.play.text = 'Kneel down by #10 J.Sayin for 1 yard loss';
  f.play.statYardage = -1; f.play.end.yardsToEndzone = 85; f.play.end.possessionText = 'OSU 15';
  f.play.end.distance = 11;
  const p = describe(f.play, f.abbr);
  assert.equal(p.movement.net, -1);
  assert.equal(p.gained, null);
  assert.equal(p.outcome, 'other');
});

test('audited catch and long-distance reports produce compact reconciled takeaways', () => {
  let f = auditedPlay('693');
  let p = describe(f.play, f.abbr);
  assert.equal(p.takeaway, 'J.Lindsey caught it 5 yards behind the line of scrimmage, then gained 9 yards after the catch: 4 yards overall.');
  assert.match(p.provenance, /start, catch, and end positions/);

  f = auditedPlay('709'); p = describe(f.play, f.abbr);
  assert.equal(p.takeaway, 'H.Fields gained 14 yards, still leaving 11 yards to the first-down line.');
  assert.match(p.provenance, /down, distance, gain, and end position/);
});

test('catch takeaways disappear when component distances contradict the reported catch spot', () => {
  const f = auditedPlay('693');
  f.play.airYards = -4; f.play.yardsAfterCatch = 8;
  const p = describe(f.play, f.abbr);
  assert.equal(p.airYards, null);
  assert.equal(p.depthText, '');
  assert.equal(p.takeaway, '');
  assert.equal(p.provenance, null);
});

test('a named quarterback hurry stays an attributed report fact across revisions', () => {
  const f = auditedPlay('714');
  let p = describe(f.play, f.abbr);
  assert.equal(p.takeaway, 'The play report credits #4 T.Banks with a quarterback hurry.');
  assert.equal(p.provenance, 'Quarterback hurry attributed by the play report.');
  assert.doesNotMatch(p.takeaway, /caused|blitz|block/i);
  assert.equal(p.depthText, '', 'An intended throw location is not a catch position.');

  f.play.text = 'No Huddle-Shotgun #6 T.Chambliss pass incomplete deep right thrown to Lou20 Original Play: #6 T.Chambliss pass incomplete short right QB hurried by #4 T.Banks';
  p = describe(f.play, f.abbr);
  assert.equal(p.takeaway, '', 'A stale Original Play clause cannot restore a removed hurry.');
  assert.equal(p.outcome, 'pass');
});

test('audited roughing ruling names the accepted penalty and possession consequence', () => {
  const f = auditedPlay('720');
  const p = describe(f.play, f.abbr);
  assert.equal(p.gameSummary, 'Penalty: roughing the kicker.');
  assert.equal(p.takeaway, 'The missed 57-yard field goal did not end the drive: a 15-yard penalty for roughing the kicker gave the offense a first down at LOU 25.');
  assert.match(p.provenance, /yardage checked/);
  assert.equal(p.gameConsequence, '', 'The advanced view states the complete ruling once.');
  assert.deepEqual(p.movement, { start: 40, end: 25, net: 15, play: 0, penalty: 15 });
});

test('declined, offsetting, multiple, and unreconciled penalties get no compressed ruling', () => {
  const base = auditedPlay('720');
  const changes = [
    text => text.replace('15 yards from', '15 yards declined from'),
    text => text.replace('15 yards from', '15 yards offsetting from'),
    text => text + ' PENALTY Miss Holding (#70 A.Player) 10 yards from Lou25 to Lou35.',
    text => text.replace('15 yards from', '10 yards from')
  ];
  for (const change of changes) {
    const f = structuredClone(base); f.play.text = change(f.play.text);
    const p = describe(f.play, f.abbr);
    assert.equal(p.takeaway, '', f.play.text);
    assert.equal(p.provenance, null, f.play.text);
  }
});

test('advanced summaries omit beginner definitions for sacks and interceptions', () => {
  assert.equal(fixture('sack').gameSummary, 'Sack for a loss of 5 yards.');
  assert.equal(fixture('sack').gameConsequence, 'Next: 3rd & 10 at OSU 37.');
  assert.equal(fixture('interception').gameSummary, 'Interception.');
  assert.equal(fixture('interception').gameConsequence, 'IU takes possession.');
  assert.equal(fixture('touchdownPass').gameSummary, '48-yard touchdown pass.');
  assert.equal(fixture('touchdownPass').gameConsequence, 'Extra point good.');
  assert.equal(fixture('touchdownPass').takeaway, '', 'The scoring result is more useful than a zero-YAC breakdown.');
  assert.doesNotMatch(fixture('sack').gameSummary, /before throwing/);
  assert.doesNotMatch(fixture('interception').gameSummary, /defender caught/);
});

test('advanced consequences keep useful state changes and drop bare scoring definitions', () => {
  assert.equal(fixture('normalRun').gameConsequence, fixture('normalRun').consequence);
  assert.equal(fixture('penalty').gameConsequence, '');
  assert.equal(fixture('penalty').takeaway, 'Delay of game moved the ball 5 yards back. Next: 1st & 15 at BALL 20.');
  assert.equal(describe({ type: { text: 'Field Goal Good' }, scoringPlay: true,
    scoringType: { name: 'fieldGoal' }, text: '42 yard field goal is GOOD' }).gameConsequence, '');
  assert.equal(describe({ type: { text: 'Safety' }, scoringType: { name: 'safety' } }).gameConsequence, '');
});

// Literal ESPN NFL final report wording inspected September 13, 2026.
test('NFL report names survive verb-less runs and parenthesized formations without naming tacklers', () => {
  const cases = [
    ['40187265664', 'Rush', 'J.Price right tackle to SEA 37 for 13 yards (K.Byard; E.Ponder).', { passer: '', receiver: '', runner: 'J.Price' }],
    ['401872656535', 'Rush', '(No Huddle) J.Price right end to SEA 29 for no gain (C.Davis; K.Byard). NE-C.Davis was injured during the play.', { passer: '', receiver: '', runner: 'J.Price' }],
    ['40187265686', 'Pass Reception', 'S.Darnold pass short middle to J.Smith-Njigba to 50 for 13 yards (R.Spillane).', { passer: 'S.Darnold', receiver: 'J.Smith-Njigba', runner: '' }],
    ['401872656157', 'Pass Incompletion', '(Shotgun) S.Darnold pass incomplete short right to R.Shaheed.', { passer: 'S.Darnold', receiver: 'R.Shaheed', runner: '' }],
    ['401872657863', 'Pass Reception', '(No Huddle, Shotgun) M.Stafford pass deep right to P.Nacua to SF 8 for 41 yards (M.Sigle; R.Green).', { passer: 'M.Stafford', receiver: 'P.Nacua', runner: '' }],
    ['401872656180', 'Sack', '(Shotgun) S.Darnold sacked at SEA 49 for -5 yards (D.Jones). SEA-S.Darnold was injured during the play.', { passer: 'S.Darnold', receiver: '', runner: '' }],
    ['401872656249', 'Rush', 'D.Maye scrambles up the middle to NE 21 for 10 yards (E.Jones; D.Witherspoon).', { passer: '', receiver: '', runner: 'D.Maye' }],
    ['401872656407', 'Pass Incompletion', '(Shotgun) D.Maye pass incomplete short right [D.Witherspoon].', { passer: 'D.Maye', receiver: '', runner: '' }],
    ['4018726571130', 'Pass Interception Return', 'B.Purdy pass short right intended for G.Kittle INTERCEPTED by Q.Lake at LA 31. Q.Lake to LA 31 for no gain (G.Kittle).', { passer: 'B.Purdy', receiver: '', runner: '' }]
  ];
  for (const [id, type, text, people] of cases) assert.deepEqual(describe({id, type:{text:type}, text}).people, people, id);
  // The same location syntax in a non-run report does not establish a runner.
  assert.equal(describe({type:{text:'Punt'},text:'J.Price right tackle to SEA 37 for 13 yards (K.Byard).'}).players, '');
});

test('NFL eligibility announcements do not become the passer or runner', () => {
  const cases = [
    ['4018726561152', 'Passing Touchdown', 'G.Van Roten reported in as eligible.  D.Maye pass short left to E.Raridon for 2 yards, TOUCHDOWN. A.Borregales extra point is GOOD, Center-J.Ashby, Holder-M.Wishnowsky.', 'pass', { passer: 'D.Maye', receiver: 'E.Raridon', runner: '' }],
    ['4018726563046', 'Rush', 'J.Jones reported in as eligible.  E.Wilson right guard to NE 45 for no gain (M.Williams).', 'run', { passer: '', receiver: '', runner: 'E.Wilson' }],
    ['4018726563908', 'Rush', 'G.Van Roten reported in as eligible.  D.Maye scrambles left end ran ob at SEA 21 for 6 yards (J.Jobe).', 'run', { passer: '', receiver: '', runner: 'D.Maye' }]
  ];
  for (const [id, type, text, outcome, people] of cases) {
    const result = describe({ id, type: { text: type }, text });
    assert.deepEqual(result.people, people, id);
    assert.equal(result.outcome, outcome, id);
    assert.equal(result.raw, text, 'The full eligibility report remains available.');
  }
  assert.equal(describe({ type: { text: 'Rush' }, text: 'J.Jones reported in as eligible.' }).players, '');
});

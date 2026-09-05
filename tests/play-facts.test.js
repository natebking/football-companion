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

test('accepted penalties suppress misleading yardage and malformed next downs', () => {
  for (const name of ['penalty', 'runWithPenalty', 'automaticFirstDown']) {
    const p = fixture(name);
    assert.equal(p.outcome, 'other', name);
    assert.equal(p.gained, null, name);
    assert.equal(p.need, null, name);
    assert.equal(p.voidReason, 'A penalty affected this play, so your pick does not count.', name);
    assert.equal(p.consequence, 'See the play report for the ruling.', name);
    assert.doesNotMatch(p.consequence, /Next:|short|First down/i, name);
  }
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

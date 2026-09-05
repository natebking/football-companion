const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const learning = require('../web/learning.js');
const concepts = require('../web/cards.json').concepts;

// Synthetic situations exercise selection boundaries, not game observations.
const situation = { down: 1, distance: 10, yardsToGoal: 75, period: 1, clockSeconds: 600 };

test('observation lessons need a valid ordinary offensive situation', () => {
  for (const input of [null, {}, { ...situation, down: 4 }, { ...situation, down: 0 },
    { ...situation, distance: 0 }, { ...situation, distance: 76 },
    { ...situation, distance: '10' }, { ...situation, yardsToGoal: NaN },
    { ...situation, yardsToGoal: 0 }, { ...situation, yardsToGoal: 100 },
    { ...situation, period: 2, clockSeconds: 0 }, { ...situation, period: 4, clockSeconds: 0 }]) {
    assert.equal(learning.choose(input), null, JSON.stringify(input));
  }
  assert.ok(learning.choose({ ...situation, clockSeconds: null }));
  assert.ok(learning.choose({ ...situation, period: 1, clockSeconds: 0 }));
});

test('lesson selection does not read play outcomes, raw text, model rates, or a changing clock', () => {
  const expected = learning.choose(situation);
  const input = { ...situation, clockSeconds: 590, outcome: 'pass', raw: 'play action', pass_rate: 1 };
  for (const key of ['outcome', 'raw', 'pass_rate', 'offenseTeam', 'previousPlay']) {
    Object.defineProperty(input, key, { get() { throw new Error('Selection read ' + key); } });
  }
  assert.equal(learning.choose(input), expected);
  assert.equal(learning.choose({ ...situation, clockSeconds: null }), expected);
});

test('red-zone lessons stay near the end zone, and all eight lessons can be selected', () => {
  const selected = new Set();
  for (let ytg = 1; ytg <= 99; ytg++) {
    for (let down = 1; down <= 3; down++) {
      for (let distance = 1; distance <= Math.min(ytg, 15); distance++) {
        const lesson = learning.choose({ ...situation, down, distance, yardsToGoal: ytg });
        selected.add(lesson.id);
        if (lesson.id === 'red_zone') assert.ok(ytg <= 20);
        if (ytg <= 10) assert.equal(lesson.id, 'red_zone');
        if (distance === ytg) assert.notEqual(lesson.id, 'first_down_line', 'There is no first-down marker in goal-to-go.');
      }
    }
  }
  assert.equal(selected.size, 8);
});

test('every observation can be skipped and no response grades knowledge', () => {
  for (const lesson of learning.all()) {
    assert.ok(lesson.choices.some(choice => choice.id === 'unsure'), lesson.id);
    assert.ok(lesson.concepts.every(id => concepts[id]), lesson.id);
    assert.equal(new Set(lesson.choices.map(choice => choice.id)).size, lesson.choices.length);
    for (const choice of lesson.choices) {
      const response = learning.observationResponse(lesson.id, choice.id);
      assert.equal(typeof response, 'string');
      assert.doesNotMatch(response, /\b(?:correct|incorrect|mastered|mastery|score|graded|you learned|you know)\b/i);
    }
  }
  assert.equal(learning.observationResponse('motion', 'pass'), null);
  assert.equal(learning.observationResponse('unknown', 'unsure'), null);
});

test('every shorter hint keeps an observation prompt and is shorter than its full version', () => {
  for (const lesson of learning.all()) {
    assert.equal(typeof lesson.shortWatch, 'string', lesson.id);
    assert.ok(lesson.shortWatch.split(/\s+/).length < lesson.watch.split(/\s+/).length, lesson.id);
    assert.doesNotMatch(lesson.shortWatch, /\b(?:will|always|correct|mastered|score)\b|\d+%/i, lesson.id);
  }
  assert.match(learning.get('motion').shortWatch, /^If /);
  assert.match(learning.get('screen_blockers').shortWatch, /^On a short pass/);
  assert.match(learning.get('pocket_edges').shortWatch, /^On a pass play/);
  assert.match(learning.get('first_down_line').shortWatch, /^On a catch/);
});

test('the app selects the preferred lesson wording without replacing its topic', () => {
  const source = fs.readFileSync(require.resolve('../web/app.js'), 'utf8');
  const assignments = source.match(/st\.watchLine = st\.lesson \?[\s\S]*?;/g);
  assert.ok(assignments.length >= 2, 'Both a new snap and changing the preference retain the lesson.');
  let short = false;
  const context = vm.createContext({ st: { lesson: learning.get('motion') }, sh: { shortHints: () => short } });
  for (const assignment of assignments) {
    short = false;
    vm.runInContext(assignment, context);
    assert.equal(context.st.watchLine, learning.get('motion').watch);
    short = true;
    vm.runInContext(assignment, context);
    assert.equal(context.st.watchLine, learning.get('motion').shortWatch);
    assert.equal(context.st.lesson.id, 'motion');
  }
});

test('instructional diagrams are accessible examples with no live data or executable markup', () => {
  for (const lesson of learning.all()) {
    const svg = learning.renderDiagram(lesson.id);
    assert.match(svg, /role="img" aria-label="Illustration/);
    assert.match(svg, /EXAMPLE ONLY/);
    assert.match(svg, /Selected players shown/);
    assert.match(svg, /viewBox="0 0 480 300"/);
    assert.doesNotMatch(svg, /<script|onload=|<foreignObject|href=|\sid=/i);
    assert.equal(svg, learning.renderDiagram(lesson.id));
  }
  assert.equal(learning.renderDiagram('"><script>alert(1)</script>'), '');
  assert.equal(learning.get('__proto__'), null);
});

test('shared lesson content is immutable and survives browser loading without DOM access', () => {
  const before = learning.get('motion').choices[0].label;
  assert.equal(Reflect.set(learning.get('motion').choices[0], 'label', 'Correct'), false);
  assert.equal(learning.get('motion').choices[0].label, before);
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/learning.js'), 'utf8'), context);
  assert.equal(context.window.FootballLearning.choose(situation).id, learning.choose(situation).id);
});

test('reported-play links use reported facts without turning a short pass into a screen diagnosis', () => {
  assert.equal(learning.relatedToReport({ raw: 'blitz screen play action', outcome: 'run', facts: [] }), null);
  assert.equal(learning.relatedToReport({ summary: 'Pass complete.', facts: ['Short pass to the left'], outcome: 'pass' }), null);
  const deep = learning.relatedToReport({ summary: 'Pass incomplete.', facts: ['Deep pass over the middle'], outcome: 'pass' });
  assert.equal(deep.lesson.id, 'deep_defenders');
  assert.match(deep.reason, /coverage was not reported/);
  const complete = learning.relatedToReport({ summary: 'Pass complete for 5 yards.', facts: [], outcome: 'pass', gained: 5, need: 10 });
  assert.equal(complete.lesson.id, 'first_down_line');
  assert.match(complete.reason, /does not locate the catch/);
});

test('sacks link to a general protection lesson while penalties suppress topic matching', () => {
  const sack = learning.relatedToReport({ summary: 'Sack. The quarterback was tackled before throwing.',
    voidReason: 'The quarterback was sacked before throwing. Your pick does not count.', facts: [] });
  assert.equal(sack.lesson.id, 'pocket_edges');
  assert.match(sack.reason, /does not identify its cause/);
  assert.equal(learning.relatedToReport({ summary: 'Quarterback scramble for 4 yards.', outcome: 'run', facts: [] }).lesson.id, 'pocket_edges');
  assert.equal(learning.relatedToReport({ summary: 'Penalty on the play.', facts: ['Deep pass'], voidReason: 'Penalty' }), null);
});

test('a verified catch position is acknowledged without pretending to know the receiver’s route', () => {
  const fixture = require('./fixtures/play-facts.json').normalPass;
  const report = require('../web/play-facts.js').describe(fixture.play, fixture.abbr);
  assert.ok(report.depthText, 'The real fixture reports an explicit catch position.');
  const related = learning.relatedToReport(report);
  assert.equal(related.lesson.id, 'first_down_line');
  assert.match(related.reason, /catch position is reported/);
  assert.match(related.reason, /does not show the receiver’s actual route/);
  assert.doesNotMatch(related.reason, /does not locate the catch/);
  const noDepth = learning.relatedToReport({ ...report, depthText: '', airYards: null });
  assert.match(noDepth.reason, /does not locate the catch/);
});

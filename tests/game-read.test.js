const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = require('../web/game-read.js');
const insights = require('../web/game-insights.js');

const sit = { gameId: '123', down: 4, distance: 2, yardsToGoal: 25, period: 4,
  clockSeconds: 130, scoreDiff: -4, offenseTeam: { id: '68' } };
const evidence = { gameId: '123', teams: [], drive: null };
function target(id, name = '#19 R.Jones', distance = 8) {
  return { id: String(id), driveId: 'drive-' + id, type: { text: 'Pass Incompletion' },
    text: '#4 M.Madsen pass incomplete short right to ' + name, statYardage: 0,
    start: { down: 3, distance, team: { id: '68' }, yardsToEndzone: 70, possessionText: 'BOIS 30' },
    end: { down: 4, distance, team: { id: '68' }, yardsToEndzone: 70, possessionText: 'BOIS 30' } };
}
function observe(plays) { return insights.forRead(insights.summarize(plays, { teamAbbreviations: { 68: 'BOIS', 2483: 'ORE' } }), '123'); }

test('fourth down uses score-and-clock consequences and never beginner fallback', () => {
  assert.match(read.select(sit).headline, /still leave them behind/);
  assert.equal(read.select(sit).question.kind, 'gokick');
  assert.match(read.select({ ...sit, scoreDiff: 3 }).headline, /keep the ball/);
  assert.match(read.select({ ...sit, scoreDiff: -3 }).headline, /tie it/);
  assert.match(read.select({ ...sit, scoreDiff: -2 }).headline, /put them ahead/);
  for (let down = 1; down <= 4; down++) for (const ytg of [2, 20, 50, 80]) {
    for (const c of read.candidates({ ...sit, down, distance: Math.min(2, ytg), yardsToGoal: ytg })) {
      assert.doesNotMatch(c.headline + c.detail + c.watch, /kick between the posts|holder kneel/i);
    }
  }
});

test('unknown clock or score never establishes a late-game consequence', () => {
  for (const change of [{ clockSeconds: null }, { scoreDiff: null }, { scoreDiff: NaN }, { period: 5 }]) {
    assert.doesNotMatch(read.select({ ...sit, ...change }).headline, /behind|ahead|clock/);
  }
  assert.equal(read.select({ ...sit, period: 4, clockSeconds: 0 }), null);
  assert.equal(read.select({ ...sit, distance: 40 }), null);
});

test('reported third-down targets drive a specific observation with source IDs', () => {
  const e = observe([target(1), target(2), target(3), target(4, '#88 M.Wagner')]);
  const c = read.select({ ...sit, down: 3, period: 1 }, e);
  assert.equal(c.id, 'third_down_target');
  assert.match(c.detail, /3 of 4/);
  assert.match(c.headline, /R.Jones/);
  assert.deepEqual(c.playIds, ['1', '2', '3', '4']);
  assert.equal(c.question, null, 'Watching alignment is not graded as a run/pass guess.');
});

test('unknown targets and same-ID corrections prevent exaggerated player patterns', () => {
  const plays = [target(1), target(2), target(3), target(4)];
  const unknown = target(5); unknown.text = 'Pass incomplete.';
  assert.ok(!read.candidates({ ...sit, down: 3 }, observe([...plays, unknown])).some(c => c.id === 'third_down_target'));
  const corrected = target(3); corrected.type.text = 'Penalty'; corrected.text = 'PENALTY. NO PLAY';
  const corrected2 = { ...corrected, id: '4' };
  const e = observe([...plays, corrected, corrected2]);
  assert.equal(e.teams[0].thirdDowns.attempts, 2);
  assert.ok(!read.candidates({ ...sit, down: 3 }, e).some(c => c.id === 'third_down_target'));
});

test('long-third-down observation describes reported attempts, not guessed drives', () => {
  const e = observe([target(1), target(2), target(3), target(4, '#8 Receiver', 2)]);
  const c = read.select({ ...sit, down: 1, period: 1 }, e);
  assert.equal(c.id, 'long_thirds'); assert.match(c.detail, /3 of 4 reported third-down plays/);
});

test('late-game clock decisions outrank old patterns and stay relevant on the next down', () => {
  const e = observe([target(1), target(2), target(3), target(4)]);
  for (const scoreDiff of [-14, -3, 3, 14]) {
    const s = { ...sit, down: 2, clockSeconds: 100, scoreDiff };
    const c = read.select(s, e);
    assert.equal(c.id, scoreDiff > 0 ? 'protect_clock' : 'chasing_score');
    assert.equal(read.select({ ...s, down: 3 }, e, [c.key]).id, c.id);
    assert.doesNotMatch(c.detail, /kneel|no timeouts|will win/i);
  }
  assert.equal(read.select({ ...sit, down: 2, scoreDiff: null }, e).id, 'long_thirds');
  assert.equal(read.select({ ...sit, down: 2, clockSeconds: null }, e).id, 'long_thirds');
});

test('penalty progress needs a verified current drive for the offense on screen', () => {
  const d = { id: 'drive', teamId: '68', complete: false, verified: true, playCount: 3,
    playYards: 11, penaltyYards: 20, sacks: 0, playIds: ['one', 'two'] };
  const s = { ...sit, down: 1, period: 1 };
  const c = read.select(s, { ...evidence, drive: d });
  assert.equal(c.id, 'penalty_progress'); assert.match(c.detail, /20 yards forward.*11 yards gained/);
  for (const update of [{ complete: true }, { verified: false }, { teamId: '2483' }, { penaltyYards: 0 }]) {
    assert.equal(read.select(s, { ...evidence, drive: { ...d, ...update } }), null);
  }
});

test('a different game or unsupported source fields cannot influence the read', () => {
  const e = observe([target(1), target(2), target(3)]);
  assert.equal(read.select({ ...sit, down: 1, period: 1 }, { ...e, gameId: 'different' }), null);
  const input = { ...sit };
  for (const key of ['raw', 'playText', 'outcome', 'formation', 'nextPlay']) {
    Object.defineProperty(input, key, { get() { throw new Error('Read ' + key); } });
  }
  assert.deepEqual(read.select(input), read.select(sit));
  const projected = JSON.stringify(observe([target(1)]));
  assert.doesNotMatch(projected, /pass incomplete|yardsToEndzone|playText|statYardage/);
});

test('ordinary repetition yields a quiet state; consequential fourth downs remain', () => {
  const s = { ...sit, down: 2, distance: 10, period: 1 };
  const first = read.select(s);
  assert.equal(first.id, 'second_long');
  assert.equal(read.select(s, evidence, [first.key]), null);
  assert.equal(read.select(s, evidence, [first.key, 'q', 'q', 'q', 'q', 'q', 'q']).id, first.id);
  const fourth = read.select(sit);
  assert.equal(read.select(sit, evidence, [fourth.key]).id, fourth.id);
});

test('one more qualifying play does not reset a pattern cooldown', () => {
  const s = { ...sit, down: 1, period: 1 };
  const plays = [target(1), target(2), target(3), target(4)];
  const c = read.select(s, observe(plays));
  assert.equal(c.id, 'long_thirds');
  assert.equal(read.select(s, observe([...plays, target(5)]), [c.key]), null);
});

test('switching modes at fourth down replaces the entire guidance, preserving explicit basics', () => {
  const app = fs.readFileSync(require.resolve('../web/app.js'), 'utf8');
  let mode = 'game';
  const basic = require('../web/cards.json').cards.find(c => c.id === 'd4_field_goal');
  const c = vm.createContext({
    window: { FootballHistory: require('../web/game-history.js'), FootballRead: read, FootballLearning: require('../web/learning.js') },
    st: { sit, rate: null, ten: null, read: null, readHistory: [], evidence },
    sh: { teachingLevel: () => mode, history: () => null, league: () => 'cfb' },
    pickCard: () => basic, fill: t => t, useShortWatch: () => false
  });
  vm.runInContext(app.slice(app.indexOf('function refreshRead('), app.indexOf('// ---------------------------------------------------------------- the ask')), c);
  c.setGuidance(true); assert.match(c.st.watchLine, /still leave them behind/);
  assert.equal(c.st.tendLine, '', 'A run/pass percentage cannot answer kick versus go.');
  mode = 'basics'; c.setGuidance(false);
  assert.match(c.st.watchLine, /kick between the posts/);
  mode = 'game'; c.setGuidance(false);
  assert.match(c.st.watchLine, /still leave them behind/);
  assert.doesNotMatch(c.st.watchLine, /holder/);
});

test('questions are off unless explicitly enabled and do not force coin-flip guesses', () => {
  const app = fs.readFileSync(require.resolve('../web/app.js'), 'utf8');
  let enabled = false;
  const c = vm.createContext({ st: { sinceAsk: 100, gap: 7, rate: .51 }, sh: { predictionQuestions: () => enabled } });
  vm.runInContext(app.slice(app.indexOf('function askEligible('), app.indexOf('// ---------------------------------------------------------------- grading')), c);
  assert.equal(c.askEligible({ kind: 'gokick', priority: 80 }), false);
  enabled = true; assert.equal(c.askEligible({ kind: 'gokick', priority: 80 }), true);
  assert.equal(c.askEligible({ kind: 'passrun', priority: 80 }), false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = require('../web/game-read.js');
const insights = require('../web/game-insights.js');

const sit = { gameId: '123', down: 4, distance: 2, yardsToGoal: 25, period: 4,
  clockSeconds: 130, scoreDiff: -4, offenseTeam: { id: '68' } };
const evidence = { gameId: '123', teams: [], drive: null };
function target(id, name = '#19 R.Jones', distance = 8, drive = 'drive-' + id, down = 3, team = '68') {
  return { id: String(id), driveId: drive, type: { text: 'Pass Incompletion' },
    text: '#4 M.Madsen pass incomplete short right to ' + name, statYardage: 0,
    start: { down, distance, team: { id: team }, yardsToEndzone: 70, possessionText: 'BOIS 30' },
    end: { down: Math.min(4, down + 1), distance, team: { id: team }, yardsToEndzone: 70, possessionText: 'BOIS 30' } };
}
function rush(id, name = '#26 S.Gaines', drive = 'drive-' + id, team = '68') {
  return { id: String(id), driveId: drive, type: { text: 'Rush' },
    text: name + ' rush middle for 2 yards gain', statYardage: 2,
    start: { down: 1, distance: 10, team: { id: team }, yardsToEndzone: 70, possessionText: 'BOIS 30' },
    end: { down: 2, distance: 8, team: { id: team }, yardsToEndzone: 68, possessionText: 'BOIS 32' } };
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
  assert.deepEqual(c.focus, { name: '#19 R.Jones', role: 'receiver' });
  assert.match(c.source, /count, not a forecast/);
  assert.doesNotMatch(c.headline + c.detail + c.watch, /formation|coverage|assignment|will (?:get|receive)/i);
  assert.equal(c.question, null, 'Watching alignment is not graded as a run/pass guess.');
});

test('partial target coverage is disclosed, while low coverage and corrections suppress the pattern', () => {
  const plays = [target(1), target(2), target(3), target(4)];
  const unknown = target(5); unknown.text = 'Pass incomplete.';
  const partial = read.candidates({ ...sit, down: 3 }, observe([...plays, unknown])).find(c => c.id === 'third_down_target');
  assert.ok(partial); assert.match(partial.detail, /receiver is named on 4 of the 5 reports/i);
  const unknown2 = { ...structuredClone(unknown), id: '6' }, unknown3 = { ...structuredClone(unknown), id: '7' };
  assert.ok(!read.candidates({ ...sit, down: 3 }, observe([...plays, unknown, unknown2, unknown3])).some(c => c.id === 'third_down_target'));
  const corrected = [2, 3, 4].map(id => { const p = target(id); p.type.text = 'Penalty'; p.text = 'PENALTY. NO PLAY'; return p; });
  const e = observe([...plays, ...corrected]);
  assert.equal(e.teams[0].thirdDowns.attempts, 1);
  assert.ok(!read.candidates({ ...sit, down: 3 }, e).some(c => c.id === 'third_down_target'));
});

test('named game involvement outranks the generic long-third observation', () => {
  const e = observe([target(1), target(2), target(3), target(4, '#8 Receiver', 2)]);
  const c = read.select({ ...sit, down: 1, period: 1 }, e);
  assert.equal(c.id, 'game_player'); assert.match(c.headline, /R.Jones/);
  assert.ok(read.candidates({ ...sit, down: 1, period: 1 }, e).some(item =>
    item.id === 'long_thirds' && /3 of 4 reported third-down plays/.test(item.detail)));
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
  assert.equal(read.select({ ...sit, down: 2, scoreDiff: null }, e).id, 'game_player');
  assert.equal(read.select({ ...sit, down: 2, clockSeconds: null }, e).id, 'game_player');
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
  const unsupported = observe([target(1, '#19 R.Jones', 10, 'd1', 1), target(2, '#19 R.Jones', 10, 'd2', 1),
    target(3, '#19 R.Jones', 10, 'd3', 1)]);
  unsupported.teams[0].actions.passPlayIds = [];
  assert.ok(!read.candidates({ ...sit, down: 1, distance: 10, period: 1 }, unsupported).some(c => c.focus));
});

test('a still-valid read is the fallback after cooldown; consequential fourth downs remain', () => {
  const s = { ...sit, down: 2, distance: 10, period: 1 };
  const first = read.select(s);
  assert.equal(first.id, 'second_long');
  assert.equal(read.select(s, evidence, [first.key]).id, first.id);
  assert.equal(read.select(s, evidence, [first.key, 'q', 'q', 'q', 'q', 'q', 'q']).id, first.id);
  const fourth = read.select(sit);
  assert.equal(read.select(sit, evidence, [fourth.key]).id, fourth.id);
});

test('a current player read keeps a stable key as its released count grows', () => {
  const s = { ...sit, down: 1, distance: 10, period: 1 };
  const plays = [target(1, '#19 R.Jones', 10, 'd1', 1), target(2, '#19 R.Jones', 10, 'd2', 1),
    target(3, '#19 R.Jones', 10, 'd3', 1), target(4, '#88 M.Wagner', 10, 'd4', 1)];
  const c = read.select(s, observe(plays));
  assert.equal(c.id, 'game_player');
  const next = read.select(s, observe([...plays, target(5, '#19 R.Jones', 10, 'd5', 1)]), [c.key]);
  assert.equal(next.id, c.id); assert.equal(next.key, c.key); assert.match(next.detail, /4 of 5/);
});

test('current-drive receiving and rushing reports produce one named player focus', () => {
  const passing = [target(1, '#19 R.Jones', 10, 'drive', 1), target(2, '#19 R.Jones', 10, 'drive', 2),
    target(3, '#88 M.Wagner', 10, 'drive', 1)];
  let c = read.select({ ...sit, down: 1, distance: 10, period: 1 }, observe(passing));
  assert.equal(c.id, 'drive_player'); assert.deepEqual(c.focus, { name: '#19 R.Jones', role: 'receiver' });
  assert.deepEqual(c.playIds, ['1', '2', '3']); assert.match(c.detail, /2 of 3 reported throws on this drive/);

  const running = [rush(4, '#26 S.Gaines', 'run-drive'), rush(5, '#26 S.Gaines', 'run-drive'),
    rush(6, '#0 D.Riley', 'run-drive')];
  c = read.select({ ...sit, down: 1, distance: 10, period: 1 }, observe(running));
  assert.equal(c.id, 'drive_player'); assert.deepEqual(c.focus, { name: '#26 S.Gaines', role: 'runner' });
  assert.match(c.detail, /2 of 3 reported runs on this drive/);
});

test('game-leading runner needs enough reports and named-run coverage', () => {
  const enough = [rush(1), rush(2), rush(3), rush(4), rush(5, '#0 D.Riley')];
  let c = read.select({ ...sit, down: 1, distance: 10, period: 1 }, observe(enough));
  assert.equal(c.id, 'game_player'); assert.deepEqual(c.focus, { name: '#26 S.Gaines', role: 'runner' });
  assert.match(c.detail, /4 of 5 reported runs in this game/);
  assert.equal(read.select({ ...sit, down: 1, distance: 10, period: 1 }, observe(enough.slice(0, 3))), null);
  const unknown = rush(6); unknown.text = 'Rush for 2 yards.';
  const unknown2 = { ...structuredClone(unknown), id: '7' };
  assert.equal(read.select({ ...sit, down: 1, distance: 10, period: 1 }, observe([...enough.slice(0, 4), unknown, unknown2])), null);
});

test('a carry leader does not displace the conversion context on long third downs', () => {
  const plays = [rush(1), rush(2), rush(3, '#26 S.Gaines', 'current'), rush(4, '#26 S.Gaines', 'current')];
  const e = observe(plays), s = { ...sit, down: 3, distance: 11, period: 1 };
  assert.ok(!read.candidates(s, e).some(c => c.focus && c.focus.role === 'runner'));
  assert.equal(read.select(s, e).id, 'third_down_distance');
  assert.equal(read.select({ ...s, distance: 2 }, e).focus.role, 'runner');
});

test('consequential drive patterns replace a player focus and remain stable while relevant', () => {
  const s = { ...sit, down: 2, distance: 8, period: 1 };
  const e = observe([rush(1), rush(2), rush(3), rush(4)]);
  const player = read.select(s, e);
  assert.equal(player.id, 'game_player');
  for (const [id, change] of [
    ['penalty_progress', { penaltyYards: 15, sacks: 0 }],
    ['drive_sacks', { penaltyYards: 0, sacks: 2 }]
  ]) {
    const updated = { ...e, drive: { ...e.drive, playCount: 4, verified: true, playYards: 4, ...change } };
    const pattern = read.select(s, updated, [player.key]);
    assert.equal(pattern.id, id);
    assert.equal(read.select(s, updated, [player.key, pattern.key]).key, pattern.key);
  }
});

test('refreshing released evidence retains the player and updates the displayed count', () => {
  const app = fs.readFileSync(require.resolve('../web/app.js'), 'utf8');
  const plays = [rush(1), rush(2), rush(3), rush(4)];
  const c = vm.createContext({
    window: { FootballRead: read, FootballLearning: require('../web/learning.js') },
    st: { sit: { ...sit, down: 2, distance: 10, period: 1 }, evidence: observe(plays),
      read: null, readHistory: [], past: null, tendLine: '' }
  });
  vm.runInContext(app.slice(app.indexOf('function refreshRead('), app.indexOf('function setGuidance(')), c);
  c.refreshRead(true);
  const key = c.st.read.key;
  c.st.evidence = observe([...plays, rush(5)]);
  c.refreshRead(false);
  assert.equal(c.st.read.key, key);
  assert.match(c.st.read.detail, /5 of 5/);
  c.st.sit.offenseTeam = { id: '2483' };
  c.refreshRead(false);
  assert.equal(c.st.read.focus, null, 'A refresh cannot carry the old team’s player into the new possession.');
});

test('higher-priority drive evidence replaces a game focus, then expires with the drive and possession', () => {
  const earlier = [1, 2, 3, 4].map(id => target(id, id < 4 ? '#19 R.Jones' : '#88 M.Wagner', 10, 'old-' + id, 1));
  const s = { ...sit, down: 1, distance: 10, period: 1 };
  const game = read.select(s, observe(earlier));
  assert.equal(game.id, 'game_player');
  const current = observe([...earlier, rush(5, '#26 S.Gaines', 'current'), rush(6, '#26 S.Gaines', 'current')]);
  const drive = read.select(s, current, [game.key]);
  assert.equal(drive.id, 'drive_player'); assert.match(drive.key, /current/);
  const completed = structuredClone(current); completed.drive.complete = true;
  const after = read.select(s, completed, [game.key, drive.key]);
  assert.equal(after.id, 'game_player'); assert.doesNotMatch(after.key, /current/);
  assert.equal(read.select({ ...s, offenseTeam: { id: '2483' } }, current, [drive.key]), null);
  assert.equal(read.select({ ...s, gameId: 'other' }, current, [drive.key]), null);
});

test('a verified negative-penalty and sack drive becomes the sole fourth-and-long read', () => {
  const d = { id: 'stall', teamId: '68', team: 'LOU', complete: false, verified: true, playCount: 3,
    playYards: 1, penaltyYards: -15, sacks: 1, playIds: ['penalty', 'sack'], actions: {}, coverage: {}, receivers: [], runners: [] };
  const s = { ...sit, down: 4, distance: 24, yardsToGoal: 89, period: 3, clockSeconds: 600, scoreDiff: 0 };
  const list = read.candidates(s, { ...evidence, drive: d });
  assert.equal(list.length, 1); assert.equal(list[0].id, 'fourth_down');
  assert.match(list[0].headline, /Penalties and a sack/);
  assert.match(list[0].detail, /15 yards lost to penalties.*need 24 yards from their own 11/);
  assert.deepEqual(list[0].playIds, ['penalty', 'sack']); assert.equal(list[0].focus, null);
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

test('a context refresh updates late-game guidance without a new exposure or question', () => {
  const app = fs.readFileSync(require.resolve('../web/app.js'), 'utf8'), handlers = {}, closed = [];
  const s = { ...sit, down:2, distance:10, period:4, clockSeconds:301, scoreDiff:3, sitKey:'2|10|25|68' };
  const c = vm.createContext({
    window: { FootballRead:read, FootballHistory:require('../web/game-history.js'), FootballLearning:require('../web/learning.js') },
    st: { sit:s, sitKey:s.sitKey, rate:null, ten:null, read:null, readHistory:[], evidence, selectionReason:'snap', sinceAsk:5 },
    sh: { teachingLevel:()=> 'game', history:()=>null, league:()=> 'cfb', bus:{on:(name,fn)=>handlers[name]=fn} },
    closePending:reason=>closed.push(reason), render:()=>{}
  });
  vm.runInContext(app.slice(app.indexOf('function refreshRead('), app.indexOf('// ---------------------------------------------------------------- the ask')), c);
  const begin=app.indexOf("sh.bus.on('context'");
  vm.runInContext(app.slice(begin, app.indexOf('// ---------------------------------------------------------------- render',begin)),c);
  c.setGuidance(true); c.st.pending={answer:'run'};
  assert.equal(c.st.read.id,'second_long');
  handlers.context({...s,clockSeconds:299});
  assert.equal(c.st.read.id,'protect_clock'); assert.equal(closed.length,1); assert.equal(c.st.sinceAsk,5);
  const n=c.st.readHistory.length;
  handlers.context({...s,clockSeconds:290});
  assert.equal(c.st.readHistory.length,n); assert.match(c.st.read.detail,/4:50/);
  handlers.context({...s,gameId:'different'}); assert.equal(c.st.sit.clockSeconds,290);
});

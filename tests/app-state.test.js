const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const loop = source.slice(source.indexOf('var pollTimer ='), source.indexOf('// ---------------------------------------------------------------- wiring'));
const grading = source.slice(source.indexOf('function grade('), source.indexOf('// ---------------------------------------------------------------- events'));
const flush = () => new Promise(resolve => setImmediate(resolve));

function polling() {
  const requests = [], applied = [], errors = [], timers = new Map();
  let timerId = 0, league = 'cfb';
  const context = vm.createContext({
    AbortController, Date,
    st: { gameId: 'A', games: [], gameState: 'in' },
    sh: {
      POLL_MS: 3000, SB_MS: 12000, LS: { game: 'game' },
      league: () => league, tend: () => ({}), diag: () => {}, lsSet: () => {}, bus: { emit: () => {} },
      showErr: message => { if (message) errors.push(message); },
      jget: (url, signal) => new Promise((resolve, reject) => requests.push({ url, signal, resolve, reject }))
    },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    summaryUrl: (league, game) => league + '/' + game,
    applySummary: value => applied.push(value),
    renderPicker: () => {}, renderFeed: () => {}, renderHeader: () => {}, refreshSyncCandidate: () => {}, waitingMessage: () => '',
    $: () => ({ className: '' })
  });
  vm.runInContext(loop, context);
  return { context, requests, applied, errors, timers, setLeague: value => { league = value; } };
}

test('repeated wake-up polls share one active request and one next timer', async () => {
  const h = polling();
  h.context.pollGame(); h.context.pollGame(); h.context.pollGame();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve('A result'); await flush();
  assert.deepEqual(h.applied, ['A result']);
  assert.deepEqual([...h.timers.values()].map(t => t.delay), [3000]);
});

test('a late response cannot overwrite a newly selected game, even if abort is ignored', async () => {
  const h = polling();
  h.context.pollGame(); h.context.selectGame('B');
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.requests[1].url, 'cfb/B');
  h.requests[0].resolve('stale A'); await flush();
  assert.deepEqual(h.applied, []);
  h.requests[1].resolve('current B'); await flush();
  assert.deepEqual(h.applied, ['current B']);
  assert.equal(h.timers.size, 1);
});

test('a failed obsolete request does not show an error or restart a second polling loop', async () => {
  const h = polling();
  h.context.pollGame(); h.context.selectGame('B');
  h.requests[0].reject(new Error('old game failed')); await flush();
  assert.deepEqual(h.errors, []);
  assert.equal(h.timers.size, 1); // Only B's request timeout remains.
  assert.equal([...h.timers.values()][0].delay, 15000);
});

test('finished games poll less frequently', async () => {
  const h = polling();
  h.context.st.gameState = 'post';
  h.context.pollGame(); h.requests[0].resolve('final'); await flush();
  assert.deepEqual([...h.timers.values()].map(t => t.delay), [30000]);
});

test('an active request has a finite timeout', () => {
  const h = polling();
  h.context.pollGame();
  const timeout = [...h.timers.values()].find(t => t.delay === 15000);
  timeout.callback();
  assert.equal(h.requests[0].signal.aborted, true);
});

const gradeContext = vm.createContext({});
vm.runInContext(grading, gradeContext);
const grade = gradeContext.grade;

test('a sack is ungraded, rather than feedback saying a pass was thrown', () => {
  const result = grade('passrun', 'pass', { kind: 'other', voidReason: 'Sacked before a throw. Your pick does not count.' });
  assert.equal(result.voided, 'Sacked before a throw. Your pick does not count.');
  assert.equal(result.ok, undefined);
});

test('a scramble is graded as the observed run', () => {
  const result = grade('passrun', 'run', { kind: 'run', gained: 12, need: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.truth, 'They ran it.');
});

test('interception return yards never earn a first-down prediction', () => {
  const result = grade('sticks', 'past', { kind: 'pass', gained: 45, need: 7, turnover: true });
  assert.ok(result.voided);
  assert.equal(result.ok, undefined);
});

test('missing or penalty-adjusted yardage is ungraded', () => {
  assert.ok(grade('sticks', 'past', { kind: 'pass', gained: null, need: 7 }).voided);
  assert.ok(grade('passrun', 'run', { kind: 'run', voidReason: 'Penalty changes the result.' }).voided);
});

test('reaching exactly the line earns the first down; falling short does not', () => {
  assert.equal(grade('sticks', 'past', { kind: 'pass', gained: 7, need: 7 }).ok, true);
  assert.equal(grade('sticks', 'short', { kind: 'pass', gained: 6, need: 7 }).ok, true);
});

test('brief hints are an explicit preference, independent of prediction history', () => {
  const begin = source.indexOf('function useShortWatch(');
  const end = source.indexOf("sh.bus.on('hints'", begin);
  let brief = false;
  const context = vm.createContext({ sh: { shortHints: () => brief } });
  vm.runInContext(source.slice(begin, end), context);
  const card = { concepts: ['blitz'], prime: { watch_short: 'Watch the rushers.' } };
  assert.equal(context.useShortWatch(card), false);
  brief = true;
  assert.equal(context.useShortWatch(card), true);
});

test('switching leagues clears the old game before its new table or schedule arrives', async () => {
  const h = polling();
  h.context.st.queue = [{ kind: 'play', row: 'CFB play' }];
  h.context.pollGame();
  h.setLeague('nfl'); h.context.clearLeague();
  assert.equal(h.context.st.gameId, null);
  assert.equal(h.context.st.queue.length, 0);
  assert.equal(h.requests[0].signal.aborted, true);
  h.context.pollGame();
  assert.equal(h.requests.length, 1); // No NFL request with a CFB game ID.
  h.requests[0].resolve('late CFB'); await flush();
  assert.deepEqual(h.applied, []);
});

test('a pick closed after switching leagues retains its original league', () => {
  const rows = [];
  const context = vm.createContext({
    Date, sh: { league: () => 'nfl', logAsk: row => rows.push(row) }
  });
  vm.runInContext(source.slice(source.indexOf('function logAskRow('), source.indexOf('function closePending(')), context);
  context.logAskRow({ league: 'cfb', game: 'A', answer: 'pass', latency: 2000 }, null, true);
  assert.equal(rows[0].lg, 'cfb');
  assert.equal(rows[0].game, 'A');
  assert.equal(rows[0].voided, true);
});

function liveQueue() {
  const events = [];
  let now = 100000;
  const context = vm.createContext({
    window: { FootballPlay: require('../web/play-facts.js'), FootballFeed: require('../web/feed-health.js') },
    Date: { now: () => now },
    st: { gameId: 'A', seen: {}, queue: [], rows: [], primed: false, lastQueuedSit: '' },
    sh: { FEED_MAX: 25, delayMs: () => 10000, diag: () => {}, bus: { emit: (name, value) => events.push({ name, value }) } },
    renderFeed: () => {}, renderHeader: () => {}, refreshSyncCandidate: () => {}
  });
  const start = source.indexOf('function collectPlays(');
  const end = source.indexOf('// ---------------------------------------------------------------- render', start);
  vm.runInContext(source.slice(start, end), context);
  return { context, events, tick: value => { now = value; context.pump(); } };
}

test('reported play facts and the next hint both wait behind the TV delay', () => {
  const h = liveQueue();
  const play = require('./fixtures/play-facts.json').normalRun.play;
  const summary = {
    header: { competitions: [{
      status: { type: { state: 'in', name: 'STATUS_IN_PROGRESS' }, period: 1, displayClock: '10:00' },
      competitors: [{ team: { id: '194', abbreviation: 'OSU' }, score: '0' }, { team: { id: '2050', abbreviation: 'BALL' }, score: '0' }]
    }] }, drives: { current: { plays: [play] } }
  };
  h.context.applySummary(summary);
  assert.equal(h.context.st.rows.length, 0);
  assert.deepEqual(h.events.filter(e => ['snap', 'result'].includes(e.name)), []);
  h.tick(110000);
  assert.equal(h.context.st.rows[0].plain, 'Run for 4 yards.');
  assert.ok(h.context.st.rows[0].players.includes('B.Jackson'));
  const snap = h.events.find(e => e.name === 'snap').value;
  assert.equal(snap.down, 2);
  assert.equal(snap.distance, 6);
  for (const field of ['raw', 'text', 'players', 'facts', 'consequence', 'gained', 'turnover']) assert.equal(field in snap, false);
  assert.ok(Object.isFrozen(snap));
  assert.equal(h.events.find(e => e.name === 'result').value.kind, 'run');
});

test('a delayed game never reveals the current score before a historical score is available', () => {
  const elements = {};
  const context = vm.createContext({
    st: { sum: { header: { competitions: [{ competitors: [
      { homeAway: 'home', team: { abbreviation: 'HOME' }, score: 21 },
      { homeAway: 'away', team: { abbreviation: 'AWAY' }, score: 14 }
    ], status: { type: { detail: 'Final' } } }] } }, shownPlay: null },
    sh: { delayMs: () => 10000, esc: value => String(value) },
    $: id => elements[id] || (elements[id] = {}), teamLogo: () => '', logoImage: () => '', paintConnection: () => {}
  });
  const start = source.indexOf('function renderHeader(');
  vm.runInContext(source.slice(start, source.indexOf('function paintConnection(', start)), context);
  context.renderHeader();
  assert.ok(!elements.score.innerHTML.includes('21'));
  assert.ok(!elements.score.innerHTML.includes('14'));
  assert.equal(elements.hmeta.textContent, 'Waiting for TV delay');
});

test('games cannot start while their league tendency table is still loading', () => {
  const h = polling();
  h.context.clearLeague();
  h.context.sh.tend = () => null;
  h.context.selectGame('B');
  assert.equal(h.context.st.gameId, null);
  assert.equal(h.requests.length, 0);
});

function summaryOf(plays) {
  return {
    header: { competitions: [{
      status: { type: { state: 'in', name: 'STATUS_IN_PROGRESS' }, period: 1, displayClock: '10:00' },
      competitors: [{ team: { id: '194', abbreviation: 'OSU' }, score: '0' }, { team: { id: '2050', abbreviation: 'BALL' }, score: '0' }]
    }] }, drives: { current: { plays } }
  };
}
function runPlay() { return structuredClone(require('./fixtures/play-facts.json').normalRun.play); }
function correctedPlay(original) {
  const play = structuredClone(original);
  play.type = { text: 'Penalty' }; play.text = 'PENALTY defense 5 yards. NO PLAY'; play.isPenalty = true;
  play.end = { ...play.end, down: 1, distance: 5, yardsToEndzone: 79, possessionText: 'OSU 21', shortDownDistanceText: '1st & 5' };
  return play;
}

test('same-ID correction updates the row and next down together after the delay', () => {
  const h = liveQueue(), original = runPlay();
  h.context.applySummary(summaryOf([original])); h.tick(110000);
  h.tick(111000); h.context.applySummary(summaryOf([correctedPlay(original)]));
  assert.equal(h.context.st.rows[0].plain, 'Run for 4 yards.');
  assert.equal(h.events.filter(e => e.name === 'snap').at(-1).value.down, 2);
  h.tick(121000);
  assert.equal(h.context.st.rows.length, 1);
  assert.match(h.context.st.rows[0].plain, /Penalty/);
  assert.equal(h.context.st.rows[0].version, 2);
  assert.equal(h.events.filter(e => e.name === 'snap').at(-1).value.down, 1);
  const results = h.events.filter(e => e.name === 'result');
  assert.equal(results.length, 2);
  assert.equal(results[1].value.revised, true);
  assert.equal(results[1].value.playId, original.id);
});

test('a queued report corrected before release never flashes or grades its old version', () => {
  const h = liveQueue(), original = runPlay();
  h.context.applySummary(summaryOf([original]));
  h.tick(105000); h.context.applySummary(summaryOf([correctedPlay(original)]));
  h.tick(110000);
  assert.equal(h.context.st.rows.length, 0);
  assert.equal(h.events.filter(e => e.name === 'result').length, 0);
  assert.equal(h.events.filter(e => e.name === 'snap').length, 0);
  h.tick(115000);
  assert.equal(h.context.st.rows.length, 1);
  const results = h.events.filter(e => e.name === 'result');
  assert.equal(results.length, 1);
  assert.ok(results[0].value.voidReason);
});

test('clock-only corrections update labels without grading the play twice', () => {
  const h = liveQueue(), original = runPlay();
  h.context.applySummary(summaryOf([original])); h.tick(110000);
  const corrected = structuredClone(original); corrected.clock = { displayValue: '9:45' };
  h.tick(111000); h.context.applySummary(summaryOf([corrected])); h.tick(121000);
  assert.equal(h.context.st.rows[0].clock, '9:45');
  assert.equal(h.events.filter(e => e.name === 'result').length, 1);
});

test('several queued corrections still invalidate the grade of the displayed version', () => {
  const h = liveQueue(), original = runPlay();
  h.context.applySummary(summaryOf([original])); h.tick(110000);
  h.tick(111000); const corrected = correctedPlay(original); h.context.applySummary(summaryOf([corrected]));
  h.tick(112000); corrected.clock = { displayValue: '9:45' }; h.context.applySummary(summaryOf([corrected]));
  h.tick(122000);
  assert.equal(h.events.filter(e => e.name === 'result' && e.value.revised).length, 1);
});

test('an older correction or late inserted play does not move the feed or scoreboard backward', () => {
  const h = liveQueue(), a = runPlay(), b = runPlay(); b.id = 'newer';
  h.context.applySummary(summaryOf([a, b])); h.tick(110000);
  h.tick(111000); h.context.applySummary(summaryOf([correctedPlay(a), b])); h.tick(121000);
  assert.equal(h.context.st.shownPlay.id, 'newer');
  assert.equal(h.context.st.rows[0].id, 'newer');
  const inserted = runPlay(); inserted.id = 'late-inserted';
  const resultCount = h.events.filter(e => e.name === 'result').length;
  h.tick(122000); h.context.applySummary(summaryOf([correctedPlay(a), inserted, b])); h.tick(132000);
  assert.equal(h.context.st.shownPlay.id, 'newer');
  assert.equal(h.context.st.rows.find(r => r.id === 'late-inserted').observedAt, null);
  assert.deepEqual(Array.from(h.context.st.rows, r => r.id), ['newer', 'late-inserted', a.id]);
  assert.equal(h.events.filter(e => e.name === 'result').length, resultCount);
});

test('the prime heading uses normalized numbers instead of a contradictory source label', () => {
  const h = liveQueue(), play = runPlay();
  play.end.shortDownDistanceText = '1st & 10';
  const snap = h.context.preSnap(summaryOf([play]), [play]);
  assert.equal(snap.down, 2);
  assert.equal(snap.distance, 6);
  assert.equal(snap.ddText, '2nd & 6');
  assert.equal(h.context.preSnap(summaryOf([play]), [play], { stalled: true }).clockSeconds, null);
});

test('a corrected result invalidates only its own prediction, without adding a second record', () => {
  const rows = [
    { lg: 'cfb', game: 'A', play_id: 'play', correct: true, voided: false },
    { lg: 'cfb', game: 'B', play_id: 'play', correct: true, voided: false }
  ];
  const context = vm.createContext({ askLog: rows, league: 'cfb', LS: { asks: 'asks' }, lsSet: () => {} });
  const start = source.indexOf('function invalidateCalls(');
  vm.runInContext(source.slice(start, source.indexOf('// ---------------------------------------------------------------- diagnostics', start)), context);
  context.invalidateCalls('A', 'play');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].correct, null);
  assert.equal(rows[0].voided, true);
  assert.equal(rows[1].correct, true);
});

test('a timeout after a corrected play cannot release the superseded next-snap card', () => {
  const h = liveQueue(), original = runPlay();
  const marker = { id: 'timeout', type: { text: 'Timeout' }, period: { number: 1 }, clock: { displayValue: '10:00' } };
  // Prime the game with no history so both the play and marker are held.
  h.context.applySummary(summaryOf([])); h.tick(110000);
  h.context.applySummary(summaryOf([original, marker]));
  h.tick(115000); h.context.applySummary(summaryOf([correctedPlay(original), marker]));
  h.tick(120000);
  assert.equal(h.events.filter(e => e.name === 'snap').length, 0);
  h.tick(125000);
  assert.equal(h.events.filter(e => e.name === 'snap').length, 1);
  assert.equal(h.events.filter(e => e.name === 'snap')[0].value.down, 1);
});

test('correcting an older queued play does not enqueue the newer next-snap card twice', () => {
  const h = liveQueue(), a = runPlay(), b = runPlay(); b.id = 'B';
  b.end.down = 3; b.end.distance = 2;
  h.context.applySummary(summaryOf([])); h.tick(110000);
  h.context.applySummary(summaryOf([a]));
  h.tick(113000); h.context.applySummary(summaryOf([a, b]));
  h.tick(116000); h.context.applySummary(summaryOf([correctedPlay(a), b]));
  h.tick(130000);
  const snapshots = h.events.filter(e => e.name === 'snap' && e.value.down === 3);
  assert.equal(snapshots.length, 1);
});

function syncControls() {
  const elements = {}, handlers = {}, events = [];
  let now = 120000;
  const context = vm.createContext({
    Date: { now: () => now },
    st: { rows: [], syncCandidate: null, syncSample: null, gameId: 'A', lastOk: 100000, lastChange: 100000 },
    $: id => elements[id] || (elements[id] = { classList: { contains: () => true }, addEventListener: (name, fn) => { handlers[id] = fn; } }),
    sh: { delayMs: () => 10000, diag: () => {}, bus: { on: () => {}, emit: (name, value) => events.push({ name, value }) } }
  });
  const start = source.indexOf('function ageText(');
  vm.runInContext(source.slice(start, source.indexOf('function renderPicker()', start)), context);
  return { context, elements, handlers, events, setNow: value => { now = value; } };
}

test('TV timing uses first receipt, excludes initial history, and keeps its selected play stable', () => {
  const h = syncControls();
  h.context.st.rows = [{ id: 'history', observedAt: null, plain: 'Old play' }];
  h.context.refreshSyncCandidate();
  assert.equal(h.elements.syncSaw.disabled, true);
  const selected = { id: 'new', version: 1, observedAt: 100000, off: 'OSU', plain: 'Run for 4 yards.' };
  h.context.st.rows.unshift(selected); h.context.refreshSyncCandidate();
  assert.equal(h.elements.syncSaw.disabled, false);
  h.context.st.rows.unshift({ id: 'newer', version: 1, observedAt: 115000 });
  h.context.refreshSyncCandidate();
  assert.equal(h.context.st.syncCandidate.id, 'new');
  h.handlers.syncSaw();
  assert.equal(h.context.st.syncSample, 20);
  assert.match(h.elements.syncResult.textContent, /20 seconds/);
});

test('a timing sample invalidates when its selected report changes', () => {
  const h = syncControls();
  h.context.st.rows = [{ id: 'new', version: 1, observedAt: 100000 }];
  h.context.refreshSyncCandidate(); h.handlers.syncSaw();
  h.context.st.rows = [{ id: 'new', version: 2, observedAt: 100000 }];
  h.context.refreshSyncCandidate();
  assert.equal(h.context.st.syncSample, null);
  assert.equal(h.elements.syncApply.hidden, true);
});

test('TV-ahead remains independent of a candidate and applying survives synchronous queue changes', () => {
  const h = syncControls();
  h.context.st.rows = [{ id: 'new', version: 1, observedAt: 100000 }]; h.context.refreshSyncCandidate();
  h.handlers.syncAhead();
  assert.equal(h.context.st.syncCandidate, null);
  assert.equal(h.context.st.syncSample, 0);
  h.context.refreshSyncCandidate();
  assert.equal(h.context.st.syncCandidate, null);
  h.context.sh.bus.emit = (name, value) => { h.events.push({ name, value }); h.context.st.syncSample = null; };
  h.handlers.syncApply();
  assert.equal(h.events[0].value, 0);
  assert.match(h.elements.syncResult.textContent, /set to 0s/);
  assert.ok(!h.elements.syncResult.textContent.includes('null'));
});

test('correcting a queued drive-ending play still clears the old card when the revision releases', () => {
  const h = liveQueue(), a = runPlay();
  const score = structuredClone(require('./fixtures/play-facts.json').touchdownPass.play);
  h.context.applySummary(summaryOf([a])); h.tick(110000);
  h.context.applySummary(summaryOf([a, score]));
  h.tick(115000); score.clock = { displayValue: '9:30' };
  h.context.applySummary(summaryOf([a, score]));
  h.tick(120000);
  assert.equal(h.events.filter(e => e.name === 'nosnap').length, 0);
  h.tick(125000);
  assert.equal(h.events.filter(e => e.name === 'nosnap').length, 1);
});

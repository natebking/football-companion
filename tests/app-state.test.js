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

function liveQueue(delay = 10000) {
  const events = [], diagnostics = [];
  let now = 100000;
  const context = vm.createContext({
    window: { FootballPlay: require('../web/play-facts.js'), FootballFeed: require('../web/feed-health.js') },
    Date: { now: () => now },
    st: { gameId: 'A', seen: {}, queue: [], rows: [], primed: false, lastQueuedSit: '', lastOk: 0, timingBreak: null },
    sh: { FEED_MAX: 25, STALE_MS: 9000, delayMs: () => delay, diag: (name, value) => diagnostics.push({ name, value }), bus: { emit: (name, value) => events.push({ name, value }) } },
    renderFeed: () => {}, renderHeader: () => {}, refreshSyncCandidate: () => {}
  });
  const start = source.indexOf('function collectPlays(');
  const end = source.indexOf('// ---------------------------------------------------------------- render', start);
  vm.runInContext(source.slice(start, end), context);
  return { context, events, diagnostics, setNow: value => { now = value; }, tick: value => { now = value; context.pump(); } };
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
    st: { rows: [], syncCandidate: null, syncSample: null, timingBreak: null, gameId: 'A', lastOk: 100000, lastChange: 100000 },
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
  h.context.st.rows = [{ id: 'new', version: 2, observedAt: 100000, timingIssue: 'revision' }];
  h.context.refreshSyncCandidate();
  assert.equal(h.context.st.syncSample, null);
  assert.equal(h.elements.syncApply.hidden, true);
  assert.equal(h.elements.syncSaw.disabled, true);
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

// Synthetic three-play drive used only to control arrival timing. The names,
// identifiers and timestamps below are test inputs, not captured game evidence.
function syntheticTimedRun(id, step = 0) {
  const play = runPlay(), from = 16 + step * 4, to = from + 4;
  const down = [1, 2, 3][step], distance = [10, 6, 2][step];
  const nextDown = [2, 3, 1][step], nextDistance = [6, 2, 10][step];
  play.id = id;
  play.text = 'Test Runner rush for 4 yards to OSU ' + to + '.';
  play.clock = { displayValue: ['9:59', '9:56', '9:53'][step] };
  play.start = { ...play.start, down, distance, yardsToEndzone: 100 - from,
    possessionText: 'OSU ' + from, downDistanceText: down + ' & ' + distance + ' at OSU ' + from };
  play.end = { ...play.end, down: nextDown, distance: nextDistance, yardsToEndzone: 100 - to,
    possessionText: 'OSU ' + to, shortDownDistanceText: nextDown + ' & ' + nextDistance };
  return play;
}

test('two forward plays received together are ineligible for TV timing', () => {
  const h = liveQueue(0), history = syntheticTimedRun('synthetic-history');
  h.context.applySummary(summaryOf([history]));
  assert.equal(h.context.st.rows[0].observedAt, null);
  const b = syntheticTimedRun('synthetic-batch-b', 1), c = syntheticTimedRun('synthetic-batch-c', 2);
  h.tick(103000); h.context.applySummary(summaryOf([history, b, c]));
  assert.equal(h.context.st.timingBreak.reason, 'batch');
  assert.equal(h.context.st.timingBreak.at, 103000);
  for (const id of [b.id, c.id]) assert.equal(h.context.st.rows.find(row => row.id === id).timingIssue, 'batch');
  const sync = syncControls();
  sync.context.st.rows = h.context.st.rows; sync.context.st.timingBreak = h.context.st.timingBreak;
  sync.context.refreshSyncCandidate();
  assert.equal(sync.context.st.syncCandidate, null);
  assert.equal(sync.elements.syncSaw.disabled, true);
});

test('a single new play followed by a timeout is still eligible for timing', () => {
  const h = liveQueue(0), play = syntheticTimedRun('synthetic-single');
  const marker = { id: 'synthetic-timeout', type: { text: 'Timeout' }, period: { number: 1 }, clock: { displayValue: '9:59' } };
  h.context.applySummary(summaryOf([]));
  h.tick(103000); h.context.applySummary(summaryOf([play, marker]));
  assert.equal(h.context.st.rows.find(row => row.id === play.id).timingIssue, null);
  assert.equal(h.context.st.timingBreak, null);
  const release = h.diagnostics.find(event => event.name === 'queue_release').value;
  assert.equal(release.trigger, 'poll');
  assert.equal(release.count, 1);
  assert.equal(release.max_overdue_ms, 0);
  const sync = syncControls(); sync.context.st.rows = h.context.st.rows;
  sync.context.refreshSyncCandidate();
  assert.equal(sync.context.st.syncCandidate.id, play.id);
  assert.equal(sync.elements.syncSaw.disabled, false);
});

test('a response gap excludes its first update but a subsequent clean update can be timed', () => {
  const h = liveQueue(0), a = syntheticTimedRun('synthetic-before-gap');
  const b = syntheticTimedRun('synthetic-after-gap', 1), c = syntheticTimedRun('synthetic-clean-followup', 2);
  h.context.applySummary(summaryOf([a]));
  assert.equal(h.context.st.lastOk, 100000);
  h.tick(110000); h.context.applySummary(summaryOf([a, b]));
  assert.equal(h.context.st.lastOk, 110000);
  assert.equal(h.context.st.timingBreak.reason, 'response_gap');
  assert.equal(h.context.st.timingBreak.at, 110000);
  assert.equal(h.context.st.rows[0].timingIssue, 'response_gap');
  const sync = syncControls();
  sync.context.st.rows = h.context.st.rows; sync.context.st.timingBreak = h.context.st.timingBreak;
  sync.context.refreshSyncCandidate();
  assert.equal(sync.context.st.syncCandidate, null);
  h.tick(113000); h.context.applySummary(summaryOf([a, b, c]));
  assert.equal(h.context.st.rows[0].timingIssue, null);
  assert.ok(h.context.st.rows[0].observedAt > h.context.st.timingBreak.at);
  sync.context.st.rows = h.context.st.rows; sync.context.refreshSyncCandidate();
  assert.equal(sync.context.st.syncCandidate.id, c.id);
});

test('timing selection never falls back from an uncertain latest play to an older clean play', () => {
  const h = syncControls();
  h.context.st.rows = [
    { id: 'synthetic-latest', version: 1, observedAt: 115000, timingIssue: 'batch' },
    { id: 'synthetic-old-clean', version: 1, observedAt: 100000, timingIssue: null }
  ];
  h.context.refreshSyncCandidate();
  assert.equal(h.context.st.syncCandidate, null);
  assert.equal(h.elements.syncSaw.disabled, true);
});

for (const reason of ['batch', 'response_gap', 'queue_catchup']) {
  test('a ' + reason + ' invalidates an already measured timing sample', () => {
    const h = syncControls();
    const selected = { id: 'synthetic-selected', version: 1, observedAt: 100000, timingIssue: null };
    h.context.st.rows = [selected]; h.context.refreshSyncCandidate(); h.handlers.syncSaw();
    assert.equal(h.context.st.syncSample, 20);
    h.context.st.timingBreak = { at: 121000, reason };
    h.context.st.rows.unshift({ id: 'synthetic-uncertain-new', version: 1, observedAt: 121000, timingIssue: reason });
    h.context.refreshSyncCandidate();
    assert.equal(h.context.st.syncSample, null);
    assert.equal(h.context.st.syncCandidate, null);
    assert.equal(h.elements.syncApply.hidden, true);
    assert.equal(h.elements.syncSaw.disabled, true);
  });
}

test('queue catch-up processes every result but shows only the final next-snap card', () => {
  const h = liveQueue(), a = syntheticTimedRun('synthetic-catchup-a');
  const b = syntheticTimedRun('synthetic-catchup-b', 1), c = syntheticTimedRun('synthetic-catchup-c', 2);
  h.context.applySummary(summaryOf([]));
  h.tick(103000); h.context.applySummary(summaryOf([a]));
  h.tick(106000); h.context.applySummary(summaryOf([a, b]));
  h.tick(109000); h.context.applySummary(summaryOf([a, b, c]));
  assert.equal(h.events.filter(event => ['snap', 'nosnap', 'result'].includes(event.name)).length, 0);
  h.tick(130000);
  const snaps = h.events.filter(event => event.name === 'snap');
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].value.down, c.end.down);
  assert.equal(snaps[0].value.yardsToGoal, c.end.yardsToEndzone);
  assert.equal(h.events.filter(event => event.name === 'nosnap').length, 0);
  assert.deepEqual(h.events.filter(event => event.name === 'result').map(event => event.value.playId), [a.id, b.id, c.id]);
  assert.equal(h.context.st.timingBreak.reason, 'queue_catchup');
  assert.equal(h.context.st.timingBreak.at, 130000);
  const release = h.diagnostics.find(event => event.name === 'queue_release').value;
  assert.equal(release.trigger, 'tick');
  assert.equal(release.count, 3);
  assert.equal(release.max_overdue_ms, 17000);
  assert.equal(release.delay_ms, 10000);
});

test('an intentional delay reduction is recorded without treating it as an interruption', () => {
  const h = liveQueue(), a = syntheticTimedRun('synthetic-delay-a'), b = syntheticTimedRun('synthetic-delay-b', 1);
  h.context.applySummary(summaryOf([]));
  h.tick(103000); h.context.applySummary(summaryOf([a]));
  h.tick(106000); h.context.applySummary(summaryOf([a, b]));
  h.setNow(130000); h.context.sh.delayMs = () => 0;
  h.context.pump('delay_change');
  const release = h.diagnostics.find(event => event.name === 'queue_release').value;
  assert.equal(release.trigger, 'delay_change');
  assert.equal(release.count, 2);
  assert.equal(release.max_overdue_ms, 27000);
  assert.equal(release.delay_ms, 0);
  assert.equal(h.context.st.timingBreak, null);
  assert.equal(h.events.filter(event => event.name === 'snap').length, 1);
});

test('queue catch-up ending in a touchdown clears the card without showing intermediate snaps', () => {
  const h = liveQueue(), a = syntheticTimedRun('synthetic-before-score');
  const score = structuredClone(require('./fixtures/play-facts.json').touchdownPass.play);
  score.id = 'synthetic-catchup-score';
  h.context.applySummary(summaryOf([]));
  h.tick(103000); h.context.applySummary(summaryOf([a]));
  h.tick(106000); h.context.applySummary(summaryOf([a, score]));
  h.tick(130000);
  assert.equal(h.events.filter(event => event.name === 'snap').length, 0);
  assert.equal(h.events.filter(event => event.name === 'nosnap').length, 1);
  assert.deepEqual(h.events.filter(event => event.name === 'result').map(event => event.value.playId), [a.id, score.id]);
});

test('an intermediate queue transition closes an old pick before a later play repeats its situation', () => {
  // Synthetic catch-up: halftime occurred, then a later possession returned to
  // the same down, distance and field position as an unresolved pick.
  const h = liveQueue(), handlers = {}, records = [], exposures = [];
  const oldKey = '1|10|84|194', finalKey = '2|6|80|194';
  const card = { id: 'synthetic-final-card', concepts: ['box'], prime: {
    situation: 'Second and 6.', tendency: '', watch: 'Watch the box.'
  } };
  const prime = vm.createContext({
    Date, window: { FootballGlossary: { close: () => {} } },
    st: {
      pending: { sitKey: oldKey, game: 'A', league: 'cfb', cardId: 'synthetic-old-card',
        kind: 'passrun', answer: 'run', latency: 1500, down: 1, distance: 10, ytg: 84 },
      sit: { sitKey: oldKey }, sitKey: oldKey, res: null, ask: null, sinceAsk: 99, skippedGrade: false
    },
    sh: {
      bus: { on: (name, handler) => { (handlers[name] || (handlers[name] = [])).push(handler); } },
      logAsk: record => records.push(record), diag: () => {}, invalidateCalls: () => {}, league: () => 'cfb',
      bumpExposure: concepts => exposures.push(concepts)
    },
    resolveTeam: () => null, lookupTendency: () => null, printedRate: () => null,
    pickCard: () => card, fill: text => text, useShortWatch: () => false,
    askFor: () => ({ id: 'synthetic-final-ask', kind: 'passrun' }), askEligible: () => true, drawGap: () => 7,
    render: () => {}, renderLedger: () => {}, flash: () => {}, $: () => ({ textContent: '' })
  });
  const sameSnapStart = source.indexOf('function sameSnap(');
  vm.runInContext(source.slice(sameSnapStart, source.indexOf('var shell =', sameSnapStart)), prime);
  prime.sh.sameSnap = prime.sameSnap;
  const eventsStart = source.indexOf('// ---------------------------------------------------------------- events');
  vm.runInContext(grading + '\n' + source.slice(eventsStart, source.indexOf('// ---------------------------------------------------------------- render', eventsStart)), prime);
  const captureLiveEvent = h.context.sh.bus.emit;
  h.context.sh.bus.emit = (name, value) => {
    captureLiveEvent(name, value);
    for (const handler of handlers[name] || []) handler(value);
  };
  const playId = 'synthetic-later-same-situation';
  h.context.st.order = { [playId]: 1 };
  h.context.st.seen = { [playId]: { version: 1 } };
  h.context.st.queue = [
    { kind: 'nosnap', at: 100000, msg: 'Halftime.', basis: 'synthetic-earlier-play', version: 1 },
    { kind: 'play', at: 100000, wasReleased: false, silent: false, marker: false,
      row: { id: playId, version: 1, observedAt: 100000, gradeKey: 'synthetic-grade' },
      cls: 'run', sitKey: oldKey, gained: 4, need: 10, turnover: false, voidReason: null },
    { kind: 'snap', at: 100000, basis: playId, version: 1, sit: {
      sitKey: finalKey, gameId: 'A', down: 2, distance: 6, yardsToGoal: 80,
      offenseTeam: { id: '194' }, defenseTeam: { id: '2050' }
    } }
  ];
  h.tick(110000);
  assert.equal(records.length, 1);
  assert.equal(records[0].correct, null);
  assert.equal(records[0].voided, true);
  assert.equal(records[0].play_id, null);
  assert.equal(records[0].card, 'synthetic-old-card');
  assert.equal(prime.st.res.head, 'No grade.');
  assert.equal(prime.st.pending.sitKey, finalKey);
  assert.equal(prime.st.pending.answer, null);
  assert.equal(exposures.length, 1);
  assert.equal(h.events.filter(event => event.name === 'snap').length, 1);
  assert.equal(h.events.filter(event => event.name === 'nosnap').length, 0);
  assert.equal(h.events.filter(event => event.name === 'result').length, 1);
});

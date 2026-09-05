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
    renderPicker: () => {}, renderFeed: () => {}, renderHeader: () => {}, waitingMessage: () => '',
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
    window: { FootballPlay: require('../web/play-facts.js') },
    Date: { now: () => now },
    st: { gameId: 'A', seen: {}, queue: [], rows: [], primed: false, lastQueuedSit: '' },
    sh: { FEED_MAX: 25, delayMs: () => 10000, diag: () => {}, bus: { emit: (name, value) => events.push({ name, value }) } },
    renderFeed: () => {}, renderHeader: () => {}
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

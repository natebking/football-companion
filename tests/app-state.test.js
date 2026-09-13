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
  const requests = [], applied = [], errors = [], insights = [], timers = new Map();
  let timerId = 0, league = 'cfb';
  const context = vm.createContext({
    AbortController, Date,
    window: { FootballDepth: { renderInsights: value => insights.push(value) } },
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
    renderPicker: () => {}, renderFeed: () => {}, renderHeader: () => {}, refreshSyncCandidate: () => {}, waitingMessage: () => '', cancelArchive: () => {},
    $: () => ({ className: '' })
  });
  vm.runInContext(loop, context);
  return { context, requests, applied, errors, insights, timers, setLeague: value => { league = value; } };
}

test('repeated wake-up polls share one active request and one next timer', async () => {
  const h = polling();
  h.context.pollGame(); h.context.pollGame(); h.context.pollGame();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve('A result'); await flush();
  assert.deepEqual(h.applied, ['A result']);
  assert.deepEqual([...h.timers.values()].map(t => t.delay), [3000]);
});

test('replay wake-ups and forced refreshes never fetch a live game or scoreboard', () => {
  const h = polling();
  h.context.sh.replay = () => true;
  h.context.pollGame();
  h.context.pollScoreboard(true);
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
});

test('replay leaves live journals, predictions, term exposure and saved delay alone', () => {
  const writes = [];
  const context = vm.createContext({
    replayMode: true, delaySec: 45, journalContext: { key: 'cfb:live' },
    journal: new Proxy({}, { get: () => () => { throw new Error('Replay attempted a live journal write'); } }),
    ledger: { concepts: { pocket: { exposures: 2 } } },
    askLog: [{ lg: 'cfb', game: 'A', play_id: 'p', correct: true }],
    league: 'cfb', lsSet: (...args) => writes.push(args)
  });
  vm.runInContext(source.slice(source.indexOf('function journalGame('), source.indexOf('window.FootballReview.init(')), context);
  vm.runInContext(source.slice(source.indexOf('function delayMs('), source.indexOf('function seasonsLabel(')), context);
  vm.runInContext(source.slice(source.indexOf('function bumpExposure('), source.indexOf('// ---------------------------------------------------------------- ask log')), context);
  vm.runInContext(source.slice(source.indexOf('function logAsk('), source.indexOf('// ---------------------------------------------------------------- diagnostics')), context);
  assert.equal(context.journalGame({ gameId: 'A' }), null);
  assert.equal(context.journalSources([{ report: {} }]), null);
  assert.equal(context.journalShown({ kind: 'play' }), null);
  assert.equal(context.journalObservation({ kind: 'resolution' }, 'cfb:live'), null);
  context.bumpExposure(['pocket']); context.logAsk({}); context.invalidateCalls('A', 'p');
  assert.equal(context.ledger.concepts.pocket.exposures, 2);
  assert.equal(context.askLog.length, 1);
  assert.equal(context.askLog[0].correct, true);
  assert.equal(context.delayMs(), 0);
  assert.equal(context.delaySec, 45);
  assert.equal(writes.length, 0);
});

test('a late response cannot overwrite a newly selected game, even if abort is ignored', async () => {
  const h = polling();
  h.context.st.feedExpanded = true;
  h.context.pollGame(); h.context.selectGame('B');
  assert.equal(h.context.st.feedExpanded, false, 'A newly selected game starts with the short feed.');
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
  h.context.st.feedExpanded = true;
  h.context.st.queue = [{ kind: 'play', row: 'CFB play' }];
  h.context.st.released = { 'old-cfb': { id: 'old-cfb' } };
  h.context.pollGame();
  h.setLeague('nfl'); h.context.clearLeague();
  assert.equal(h.context.st.gameId, null);
  assert.equal(h.context.st.feedExpanded, false);
  assert.equal(h.context.st.queue.length, 0);
  assert.equal(Object.keys(h.context.st.released).length, 0);
  assert.equal(h.insights.at(-1).drive, null);
  assert.equal(h.insights.at(-1).teams.length, 0);
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
  const events = [], diagnostics = [], insightInputs = [], insights = [];
  let now = 100000;
  const context = vm.createContext({
    window: {
      FootballPlay: require('../web/play-facts.js'), FootballFeed: require('../web/feed-health.js'),
      FootballLearning: require('../web/learning.js'),
      FootballInsights: { forRead: require('../web/game-insights.js').forRead, summarize: (plays, options) => {
        insightInputs.push(structuredClone(Array.from(plays)));
        return require('../web/game-insights.js').summarize(plays, options);
      } },
      FootballDepth: { renderInsights: value => insights.push(structuredClone(value)) }
    },
    Date: { now: () => now },
    st: { gameId: 'A', seen: {}, queue: [], rows: [], released: {}, primed: false, lastQueuedSit: '', lastOk: 0, timingBreak: null },
    sh: { FEED_MAX: 25, STALE_MS: 9000, delayMs: () => delay, diag: (name, value) => diagnostics.push({ name, value }), bus: { emit: (name, value) => events.push({ name, value }) } },
    renderFeed: () => {}, renderHeader: () => {}, refreshSyncCandidate: () => {}
  });
  const start = source.indexOf('function collectPlays(');
  const end = source.indexOf('// ---------------------------------------------------------------- render', start);
  vm.runInContext(source.slice(start, end), context);
  const renderStart = source.indexOf('function renderInsights(');
  vm.runInContext(source.slice(renderStart, source.indexOf('function ageText(', renderStart)), context);
  return { context, events, diagnostics, insightInputs, insights,
    setNow: value => { now = value; }, tick: value => { now = value; context.pump(); } };
}

test('seeking backward rebuilds live analysis without later reports, scores or totals', () => {
  const replay = require('../web/replay.js');
  const model = replay.prepare(require('./fixtures/louisville-ole-miss-2026.json'));
  const h = liveQueue(0), c = h.context;
  Object.assign(c, { URL, gameGeneration: 0, pollTimer: null, pollRequest: null,
    clearTimeout: () => {}, $: () => ({}), renderReplayControls: () => {},
    replaySession: model, replayCount: null });
  Object.assign(c.window, { FootballReplay: replay,
    location: { href: 'https://example.test/?replay=cfb:401856661' },
    history: { replaceState: (_state, _title, url) => { c.window.location.href = String(url); } } });
  vm.runInContext(source.slice(source.indexOf('function resetGame('), source.indexOf('function clearLeague(')), c);
  vm.runInContext(source.slice(source.indexOf('function seekReplay('), source.indexOf('function startReplay(')), c);
  c.seekReplay(model.plays.length);
  assert.equal(c.st.gameState, 'post');
  assert.equal(c.st.shownBoard.homeScore, 41);
  c.seekReplay(161);
  assert.equal(c.st.gameState, 'in');
  assert.equal(c.st.shownBoard.homeScore, 31);
  assert.equal(c.st.shownBoard.awayScore, 24);
  assert.equal(c.st.rows[0].id, '401856661693');
  const allowed = new Set(model.plays.slice(0, 161).map(p => p.id));
  assert.ok(Object.keys(c.st.released).every(id => allowed.has(id)));
  const fresh = liveQueue(0);
  fresh.context.applySummary(replay.snapshot(model, 161));
  assert.deepEqual(h.insights.at(-1), fresh.insights.at(-1));
  c.seekReplay(0);
  assert.equal(c.st.rows.length, 0);
  assert.equal(Object.keys(c.st.released).length, 0);
  assert.equal(c.st.shownBoard.homeScore, null);
  assert.equal(c.st.shownBoard.awayScore, null);
});

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

test('historical season context travels with the delayed snap and is never inferred', () => {
  const h = liveQueue(), play = runPlay();
  const summary = summaryOf([play]);
  assert.equal(h.context.preSnap(summary, [play]).season, null);
  assert.equal(h.context.preSnap(summary, [play]).seasonType, null);
  summary.header.season = { year: 2026, type: 2 };
  h.context.applySummary(summary);
  assert.equal(h.events.filter(e => e.name === 'snap').length, 0);
  h.tick(110000);
  const snap = h.events.find(e => e.name === 'snap').value;
  assert.equal(snap.season, 2026); assert.equal(snap.seasonType, 2);
  summary.header.season.year = 2027;
  assert.equal(snap.season, 2026);
});

test('score and clock refresh the same upcoming play only after the TV delay', () => {
  const h = liveQueue(), play = runPlay(), summary = summaryOf([play]);
  const comp = summary.header.competitions[0];
  comp.competitors[0].homeAway = 'home'; comp.competitors[1].homeAway = 'away';
  comp.status.period = 4; comp.status.displayClock = '5:01';
  h.context.applySummary(summary); h.tick(110000);
  assert.equal(h.context.st.shownBoard.detail, 'Q4 5:01');
  assert.equal(h.events.filter(e => e.name === 'snap').length, 1);
  const transitions = h.events.filter(e => e.name === 'transition').length;
  h.setNow(111000); comp.status.displayClock = '4:59'; comp.competitors[0].score = '7';
  summary.header.season = { year: 2026, type: 2 };
  h.context.applySummary(summary); h.tick(120999);
  assert.equal(h.context.st.shownBoard.homeScore, 0);
  assert.equal(h.events.filter(e => e.name === 'context').length, 0);
  h.tick(121000);
  const next = h.events.find(e => e.name === 'context').value;
  assert.equal(next.clockSeconds, 299); assert.equal(next.scoreDiff, 7); assert.equal(next.season, 2026);
  assert.equal(h.context.st.shownBoard.detail, 'Q4 4:59'); assert.equal(h.context.st.shownBoard.homeScore, 7);
  assert.equal(h.events.filter(e => e.name === 'snap').length, 1);
  assert.equal(h.events.filter(e => e.name === 'transition').length, transitions);
  h.setNow(122000); h.context.applySummary(summary); h.tick(132000);
  assert.equal(h.events.filter(e => e.name === 'context').length, 1, 'Identical polls are not new context.');
});

test('a later report with identical end position is a new snap, not a clock refresh', () => {
  const h = liveQueue(), a = runPlay(), b = runPlay(); b.id = 'another-play-same-end';
  h.context.applySummary(summaryOf([a])); h.tick(110000);
  h.setNow(111000); h.context.applySummary(summaryOf([a,b])); h.tick(121000);
  assert.equal(h.events.filter(e => e.name === 'snap').length, 2);
  assert.equal(h.events.filter(e => e.name === 'context').length, 0);
});

test('catch-up publishes one new snap with its latest due clock', () => {
  const h = liveQueue(), summary = summaryOf([runPlay()]);
  h.context.applySummary(summary);
  h.setNow(101000); summary.header.competitions[0].status.displayClock = '9:57'; h.context.applySummary(summary);
  h.tick(111000);
  assert.equal(h.events.filter(e => e.name === 'snap').length, 1);
  assert.equal(h.events.find(e => e.name === 'snap').value.clockSeconds, 597);
  assert.equal(h.events.filter(e => e.name === 'context').length, 0);
});

test('a corrected report also holds its dependent clock refresh behind the full delay', () => {
  const h = liveQueue(), play = runPlay(), summary = summaryOf([play]);
  h.context.applySummary(summary);
  h.setNow(101000); summary.header.competitions[0].status.displayClock = '9:57'; h.context.applySummary(summary);
  h.setNow(102000); play.text += ' Corrected report.'; h.context.applySummary(summary);
  h.tick(111000);
  assert.equal(h.events.filter(e => ['snap','context'].includes(e.name)).length, 0);
  h.tick(112000);
  assert.equal(h.events.filter(e => e.name === 'snap').length, 1);
  assert.equal(h.events.find(e => e.name === 'snap').value.clockSeconds, 597);
});

test('unknown scoreboard values stay unknown and final status follows its delay', () => {
  const h = liveQueue(), summary = summaryOf([runPlay()]), comp = summary.header.competitions[0];
  comp.competitors[0].homeAway = 'home'; comp.competitors[0].score = null;
  comp.competitors[1].homeAway = 'away'; comp.competitors[1].score = '';
  h.context.applySummary(summary); h.tick(110000);
  assert.equal(h.context.st.shownBoard.homeScore, null); assert.equal(h.context.st.shownBoard.awayScore, null);
  h.setNow(111000); comp.status.type = { state:'post', name:'STATUS_FINAL', detail:'Final' }; h.context.applySummary(summary);
  assert.notEqual(h.context.st.shownBoard.detail, 'Final');
  h.tick(121000); assert.equal(h.context.st.shownBoard.detail, 'Final');
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
  const context = vm.createContext({ askLog: rows, league: 'cfb', replayMode: false, LS: { asks: 'asks' }, lsSet: () => {} });
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

function syntheticHistory() {
  // Ten small synthetic drives make the aggregate history exceed the 25-row
  // visible feed. They are not a reconstruction of an actual game.
  const drives = Array.from({ length: 10 }, (_, drive) => ({
    id: 'synthetic-drive-' + drive,
    plays: Array.from({ length: 3 }, (_, step) => syntheticTimedRun('synthetic-history-' + drive + '-' + step, step))
  }));
  const summary = summaryOf([]);
  summary.drives = { previous: drives.slice(0, -1), current: drives.at(-1) };
  return summary;
}

test('game summaries retain all initial history after release even when the visible feed has 25 rows', () => {
  const h = liveQueue(), summary = syntheticHistory();
  h.context.applySummary(summary);
  assert.equal(Object.keys(h.context.st.released).length, 0);
  assert.equal(h.insights.length, 0);
  h.tick(109999);
  assert.equal(h.insights.length, 0);
  h.tick(110000);
  assert.equal(h.context.st.rows.length, 25);
  assert.equal(Object.keys(h.context.st.released).length, 30);
  assert.equal(h.insightInputs.at(-1).length, 30);
  assert.equal(h.insights.at(-1).coverage.uniqueReports, 30);
  assert.equal(h.insights.at(-1).teams[0].coverage.observedPlays, 30);
  assert.equal(h.insights.at(-1).teams[0].earlyDowns.runs, 20);
  assert.equal(h.insights.at(-1).drive.id, 'synthetic-drive-9');
  assert.equal(h.insights.at(-1).drive.netYards, 12);
  assert.equal(h.insightInputs.at(-1)[0].driveId, 'synthetic-drive-0');
  assert.equal(summary.drives.previous[0].plays[0].driveId, undefined, 'Collection does not mutate the source play.');
  assert.equal(h.events.filter(event => event.name === 'result').length, 1, 'Initial history does not grade old plays.');
});

test('a new source report cannot enter game summaries before its TV delay expires', () => {
  const h = liveQueue(), a = syntheticTimedRun('synthetic-visible'), b = syntheticTimedRun('synthetic-held', 1);
  const first = summaryOf([a]); first.drives.current.id = 'synthetic-delay-drive';
  h.context.applySummary(first); h.tick(110000);
  assert.equal(h.insights.at(-1).drive.netYards, 4);
  const next = summaryOf([a, b]); next.drives.current.id = 'synthetic-delay-drive';
  h.tick(111000); h.context.applySummary(next);
  assert.equal(h.context.st.sum.drives.current.plays.length, 2, 'The source already contains the held play.');
  // An unrelated repaint must still summarize the released records only.
  h.context.renderInsights();
  assert.deepEqual(h.insightInputs.at(-1).map(play => play.id), [a.id]);
  assert.equal(h.insights.at(-1).teams[0].earlyDowns.runs, 1);
  assert.equal(h.insights.at(-1).drive.netYards, 4);
  h.tick(120999);
  assert.equal(h.insights.at(-1).coverage.uniqueReports, 1);
  h.tick(121000);
  assert.deepEqual(h.insightInputs.at(-1).map(play => play.id), [a.id, b.id]);
  assert.equal(h.insights.at(-1).teams[0].earlyDowns.runs, 2);
  assert.equal(h.insights.at(-1).drive.netYards, 8);
});

test('a same-ID correction outside the visible feed replaces its old aggregate contributions after release', () => {
  const h = liveQueue(), original = syntheticHistory();
  const id = original.drives.previous[0].plays[0].id;
  h.context.applySummary(original); h.tick(110000);
  assert.equal(h.context.st.rows.some(row => row.id === id), false);
  const revised = structuredClone(original), play = revised.drives.previous[0].plays[0];
  play.type = { text: 'Pass' };
  play.text = 'Test Quarterback pass complete short left to Test Receiver for 4 yards to OSU 20.';
  h.tick(113000); h.context.applySummary(revised);
  h.context.renderInsights();
  assert.equal(h.insights.at(-1).teams[0].earlyDowns.runs, 20);
  assert.equal(h.insights.at(-1).teams[0].earlyDowns.passes, 0);
  assert.equal(h.context.st.released[id].type.text, original.drives.previous[0].plays[0].type.text);
  h.tick(123000);
  const result = h.insights.at(-1), team = result.teams[0];
  assert.equal(result.coverage.uniqueReports, 30);
  assert.equal(h.insightInputs.at(-1).filter(play => play.id === id).length, 1);
  assert.equal(h.context.st.released[id].type.text, 'Pass');
  assert.equal(team.earlyDowns.runs, 19);
  assert.equal(team.earlyDowns.passes, 1);
  assert.equal(team.coverage.runs, 29);
  assert.equal(team.coverage.passes, 1);
  assert.equal(team.directions.pass.left, 1);
  assert.equal(team.receivers[0].name, 'Test Receiver');
  assert.equal(team.receivers[0].targets, 1);
  assert.equal(h.context.st.rows.length, 25);
  assert.equal(h.context.st.rows.some(row => row.id === id), false);
});

test('a superseded queued report never contributes its old version to game summaries', () => {
  const h = liveQueue(), run = syntheticTimedRun('synthetic-corrected-before-release');
  h.context.applySummary(summaryOf([run]));
  const pass = structuredClone(run);
  pass.type = { text: 'Pass' };
  pass.text = 'Test Quarterback pass complete short left to Test Receiver for 4 yards to OSU 20.';
  h.tick(105000); h.context.applySummary(summaryOf([pass]));
  h.tick(110000);
  assert.equal(Object.keys(h.context.st.released).length, 0);
  assert.ok(h.insights.every(result => result.teams.length === 0));
  h.tick(115000);
  assert.equal(h.insights.at(-1).coverage.uniqueReports, 1);
  assert.equal(h.insights.at(-1).teams[0].earlyDowns.runs, 0);
  assert.equal(h.insights.at(-1).teams[0].earlyDowns.passes, 1);
  assert.ok(h.insightInputs.every(plays => plays.every(play => play.type.text === 'Pass')));
});

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
  const h = liveQueue(), handlers = {}, records = [], exposures = [], journalLinks = [];
  const oldKey = '1|10|84|194', finalKey = '2|6|80|194';
  const card = { id: 'synthetic-final-card', concepts: ['box'], prime: {
    situation: 'Second and 6.', tendency: '', watch: 'Watch the box.'
  } };
  const prime = vm.createContext({
    Date, window: { FootballGlossary: { close: () => {} }, FootballLearning: require('../web/learning.js') },
    st: {
      pending: { sitKey: oldKey, game: 'A', league: 'cfb', cardId: 'synthetic-old-card',
        kind: 'passrun', answer: 'run', latency: 1500, down: 1, distance: 10, ytg: 84 },
      journalIds: ['shown:old'], sit: { sitKey: oldKey }, sitKey: oldKey, res: null, ask: null, sinceAsk: 99, skippedGrade: false
    },
    sh: {
      bus: { on: (name, handler) => { (handlers[name] || (handlers[name] = [])).push(handler); } },
      logAsk: record => records.push(record), diag: () => {}, invalidateCalls: () => {}, league: () => 'cfb',
      shortHints: () => false,
      teachingLevel: () => 'basics',
      journalObservation: row => journalLinks.push(row),
      bumpExposure: concepts => exposures.push(concepts)
    },
    resolveTeam: () => null, lookupTendency: () => null, printedRate: () => null,
    pickCard: () => card, fill: text => text, useShortWatch: () => false,
    askFor: () => ({ id: 'synthetic-final-ask', kind: 'passrun' }), askEligible: () => true, drawGap: () => 7,
    render: () => {}, renderLedger: () => {}, flash: () => {}, $: () => ({ textContent: '' })
  });
  prime.setGuidance = () => { prime.st.lesson = null; prime.st.watchLine = card.prime.watch; };
  const sameSnapStart = source.indexOf('function sameSnap(');
  vm.runInContext(source.slice(sameSnapStart, source.indexOf('var shell =', sameSnapStart)), prime);
  prime.sh.sameSnap = prime.sameSnap;
  const eventsStart = source.indexOf('// ---------------------------------------------------------------- events');
  vm.runInContext(grading + '\n' + source.slice(eventsStart, source.indexOf('// ---------------------------------------------------------------- render', eventsStart)), prime);
  const journalEventStart = source.indexOf("sh.bus.on('result'", source.indexOf('function captureGuidance('));
  vm.runInContext(source.slice(journalEventStart, source.indexOf('function renderAsk(', journalEventStart)), prime);
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
  assert.equal(journalLinks.length, 0, 'The old prompt must not link across a transition.');
  assert.equal(records.length, 1);
  assert.equal(records[0].correct, null);
  assert.equal(records[0].voided, true);
  assert.equal(records[0].play_id, null);
  assert.equal(records[0].card, 'synthetic-old-card');
  assert.equal(prime.st.res.head, 'No grade.');
  assert.equal(prime.st.pending.sitKey, finalKey);
  assert.equal(prime.st.pending.answer, null);
  assert.equal(exposures.length, 1);
  assert.equal(prime.st.watchLine, card.prime.watch);
  assert.deepEqual(exposures[0], card.concepts);
  assert.equal(h.events.filter(event => event.name === 'snap').length, 1);
  assert.equal(h.events.filter(event => event.name === 'nosnap').length, 0);
  assert.equal(h.events.filter(event => event.name === 'result').length, 1);
});

// Preserve the number the reader saw, not an unrounded internal estimate.
test('journal guidance stores displayed probability and exact wording separately from the model', () => {
  const saved = [];
  const text = { pDD: '1st & 10', pSpot: 'at ORE25', pSit: '', pTen: 'They run here 58% of the time.', pWatch: 'Watch the space.' };
  const c = vm.createContext({
    st: { sit: { down: 1 }, sitKey: 'one', card: { id: 'card', prints_number: true },
      ten: { pass_rate: 0.41777, league_pass_rate: 0.46 }, lesson: { id: 'space' },
      tendLine: text.pTen, attributed: true, journalSignature: '', journalIds: [] },
    document: { visibilityState: 'visible', querySelector: selector => selector === '.tendency-block' ? { open: true } : null },
    $: id => ({ textContent: text[id] }),
    sh: { teachingLevel: () => 'game', journalShown: entry => { saved.push(entry); return { ok: true, id: 'shown:1' }; } }
  });
  const begin = source.indexOf('function captureGuidance(');
  vm.runInContext(source.slice(begin, source.indexOf("window.addEventListener('football-view-visible'", begin)), c);
  c.captureGuidance(); c.captureGuidance();
  assert.equal(saved.length, 1); assert.ok(Math.abs(saved[0].probabilityShown - 0.42) < 1e-10);
  assert.equal(saved[0].modelProbability, 0.41777); assert.equal(saved[0].lines.tendency, text.pTen);
  c.st.card.prints_number = false; c.st.journalSignature = ''; c.captureGuidance();
  assert.equal(saved[1].probabilityShown, null);
  c.st.card.prints_number = true; c.st.journalSignature = '';
  c.document.querySelector = selector => selector === '.tendency-block' ? { open: false } : null;
  c.captureGuidance();
  assert.equal(saved[2].probabilityShown, null, 'A collapsed historical estimate was not displayed to the viewer.');
});

test('a queued correction retains order and holds newer plays until its full delay', () => {
  const h = liveQueue();
  const a = structuredClone(require('./fixtures/play-facts.json').normalRun.play);
  const b = structuredClone(a); b.id = 'later';
  h.context.applySummary(summaryOf([a]));
  h.setNow(101000); h.context.applySummary(summaryOf([a, b]));
  const corrected = structuredClone(a); corrected.text += ' Corrected report.';
  h.setNow(102000); h.context.applySummary(summaryOf([corrected, b]));
  h.tick(111000);
  assert.equal(Object.keys(h.context.st.released).length, 0, 'B cannot jump ahead of corrected A.');
  h.tick(112000);
  assert.deepEqual(h.diagnostics.filter(r => r.name === 'release').map(r => r.value.id), [String(a.id), 'later']);
  const names = h.events.map(e => e.name);
  assert.ok(names.lastIndexOf('evidence') < names.lastIndexOf('snap'), 'Read evidence is ready before selecting the next card.');
});

function feedView(count = 8) {
  const saved = [], elements = {};
  const row = number => ({ id: String(number), version: 'v1', off: 'ORE', dd: '1st & 10',
    when: 'Q1 10:00', kind: 'run', plain: 'Run for 4 yards.', gamePlain: 'Run for 4 yards.', gameConsequence: '', takeaway: '', provenance: null, facts: [], observedAt: 1 });
  const rows = Array.from({ length: count }, (_, i) => row(count - i));
  const context = vm.createContext({
    FEED_PREVIEW: 3,
    st: { rows, released: Object.fromEntries(rows.map(r => [r.id, { id: r.id }])),
      sum: null, health: null, feedExpanded: false },
    sh: { esc: value => String(value ?? ''), teachingLevel: () => 'game', journalShown: entry => saved.push(entry) },
    window: { FootballGlossary: { annotate: value => value }, FootballPlay: { describe: report => report } },
    teamAbbrs: () => ({}),
    $: id => elements[id] || (elements[id] = {
      innerHTML: '', hidden: false, textContent: '', attributes: {},
      querySelectorAll: () => [], setAttribute(name, value) { this.attributes[name] = value; }
    })
  });
  const begin = source.indexOf('function renderFeed(');
  vm.runInContext(source.slice(begin, source.indexOf('function renderInsights(', begin)), context);
  return { context, elements, saved, row };
}

test('collapsed older reports enter the viewing journal only when the feed is expanded', () => {
  const h = feedView();
  h.context.renderFeed();
  assert.deepEqual(h.saved.map(entry => entry.playId), ['8', '7', '6']);
  assert.equal(h.context.st.rows.length, 8, 'Collapsing does not discard available reports.');
  assert.equal(Object.keys(h.context.st.released).length, 8, 'Analysis retains every released report.');
  // A correction can arrive while its older report is hidden. The journal
  // should capture the version actually revealed, not either hidden version.
  h.context.st.rows[7].version = 'v2';
  h.context.st.rows[7].plain = h.context.st.rows[7].gamePlain = 'Run for 5 yards.';
  h.context.st.released['1'] = { id: '1', corrected: true };
  h.context.renderFeed();
  assert.equal(h.saved.length, 3);
  h.context.st.feedExpanded = true;
  h.context.renderFeed();
  assert.deepEqual(h.saved.map(entry => entry.playId), ['8', '7', '6', '5', '4', '3', '2', '1']);
  assert.equal(h.saved.at(-1).lines.summary, 'Run for 5 yards.');
  assert.equal(h.saved.at(-1).report.corrected, true);
  h.context.st.feedExpanded = false;
  h.context.renderFeed();
  h.context.st.feedExpanded = true;
  h.context.renderFeed();
  assert.equal(h.saved.length, 8, 'Toggling does not duplicate unchanged viewing records.');
});

test('an expanded feed stays expanded as newly released plays are rendered', () => {
  const h = feedView();
  h.context.st.feedExpanded = true;
  h.context.renderFeed();
  h.context.st.rows.unshift(h.row(9));
  h.context.st.released['9'] = { id: '9' };
  h.context.renderFeed();
  assert.equal(h.context.st.feedExpanded, true);
  assert.equal(h.elements.feedToggle.attributes['aria-expanded'], 'true');
  assert.equal(h.saved.length, 9);
  assert.equal(h.saved.at(-1).playId, '9');
});


test('latest takeaway is visible and journaled; advanced facts stay behind disclosure', () => {
  const h = feedView(2), r = h.context.st.rows[0];
  Object.assign(r, { plain: 'Sack. The quarterback was tackled before throwing.', gamePlain: 'Sack for a loss of 5 yards.',
    takeaway: 'The report credits Banks with a hurry.', provenance: 'Reported by ESPN.', facts: ['Shotgun'], gameConsequence: 'Next: 3rd & 15.' });
  h.context.renderFeed();
  assert.equal(h.saved[0].lines.summary, r.gamePlain);
  assert.equal(h.saved[0].lines.takeaway, r.takeaway);
  assert.deepEqual(Array.from(h.saved[0].lines.facts), []);
  assert.ok(h.elements.feed.innerHTML.indexOf('play-takeaway') < h.elements.feed.innerHTML.indexOf('data-understand'));
  assert.ok(!h.elements.feed.innerHTML.includes('Quarterback starts back from center'));
  h.elements.feed.querySelectorAll = selector => selector.includes('understand') ? [{ dataset: { understand: r.id }, open: true }] : [];
  h.context.captureFeed();
  assert.deepEqual(Array.from(h.saved.at(-1).lines.facts), ['Shotgun']);
  h.context.sh.teachingLevel = () => 'basics';
  h.context.renderFeed();
  assert.ok(h.saved.some(entry => entry.lines.summary === r.plain && entry.teachingLevel === 'basics'));
});

test('a revised latest takeaway replaces the visible wording and is recorded as a correction', () => {
  const h = feedView(1), r = h.context.st.rows[0];
  r.takeaway = 'Initially reported detail.';
  h.context.renderFeed();
  r.version = 'v2'; r.takeaway = ''; r.gamePlain = 'Incomplete pass.';
  h.context.st.released[r.id] = { id: r.id, revised: true };
  h.context.renderFeed();
  assert.equal(h.saved.length, 2);
  assert.equal(h.saved.at(-1).lines.takeaway, null);
  assert.ok(!h.elements.feed.innerHTML.includes('Initially reported detail'));
});

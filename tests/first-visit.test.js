const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../web/app.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function delaySettings(saved) {
  const elements = {}, writes = [], events = [];
  const c = vm.createContext({
    LS: { delay: 'delay' }, MAX_DELAY: 90, lsGet: () => saved,
    lsSet: (key, value) => writes.push({ key, value }),
    $: id => elements[id] || (elements[id] = {}),
    bus: { emit: (...args) => events.push(args) }
  });
  vm.runInContext(source.slice(source.indexOf('var savedDelay ='), source.indexOf('var HISTORY =')), c);
  vm.runInContext(source.slice(source.indexOf('function paintDelay()'), source.indexOf("$('delayBtn').addEventListener")), c);
  c.paintDelay();
  return { c, elements, writes, events };
}

test('new viewers get a labelled delay estimate, while an explicit zero remains zero', () => {
  const fresh = delaySettings(null);
  assert.equal(fresh.c.delaySec, 45);
  assert.equal(fresh.elements.delayBtn.textContent, 'Sync TV');
  assert.match(fresh.elements.dNote.textContent, /guess, not a measured match/);
  assert.equal(fresh.writes.length, 0);
  const saved = delaySettings('0');
  assert.equal(saved.c.delaySec, 0);
  assert.equal(saved.elements.delayBtn.textContent, 'TV +0s');
  for (const bad of ['oops', '-1', '91']) assert.equal(delaySettings(bad).c.delaySec, 45);
});

test('confirming the starting delay saves it, including when the value stays 45', () => {
  const h = delaySettings(null);
  h.c.setDelay(45);
  assert.equal(h.elements.delayBtn.textContent, 'TV +45s');
  assert.equal(h.writes[0].value, '45');
  h.c.setDelay(NaN);
  assert.equal(h.writes.length, 1);
  h.c.setDelay(0);
  assert.equal(h.elements.delayBtn.textContent, 'TV +0s');
});

function selection(saved, rows) {
  const handlers = {}, picked = [], messages = [];
  const c = vm.createContext({
    gameGeneration: 1, st: {},
    sh: { LS: { game: 'game_' }, lsGet: () => saved, league: () => 'cfb',
      bus: { on: (key, fn) => { handlers[key] = fn; }, emit: (...args) => messages.push(args) }, showErr: () => {} },
    fetchGames: () => Promise.resolve(rows), selectGame: id => picked.push(id),
    renderPicker: () => {}, renderHeader: () => {}, pollGame: () => {}, pollScoreboard: () => {}
  });
  let start = source.indexOf("sh.bus.on('leagueChanged',");
  vm.runInContext(source.slice(start, source.indexOf("sh.bus.on('delay',", start)), c);
  start = source.indexOf("sh.bus.on('boot',");
  vm.runInContext(source.slice(start, source.indexOf('})(shell);', start)), c);
  return { handlers, picked, messages };
}

test('boot and league changes restore only the saved unfinished game', async () => {
  const rows = [{ id: 'live', state: 'in' }, { id: 'saved', state: 'in' }, { id: 'finished', state: 'post' }];
  for (const event of ['boot', 'leagueChanged']) {
    for (const saved of [null, 'missing', 'finished']) {
      const h = selection(saved, rows);
      h.handlers[event](); await flush();
      assert.equal(h.picked.length, 0, event + ': do not substitute another live game');
      assert.match(h.messages[0][1], /Choose a game/);
    }
    const h = selection('saved', rows);
    h.handlers[event](); await flush();
    assert.deepEqual(h.picked, ['saved']);
  }
});

test('scoreboard refresh never starts a game on behalf of the viewer', async () => {
  const selected = [];
  const c = vm.createContext({
    sbTimer: null, scoreboardGeneration: 0, st: { gameId: null },
    clearTimeout: () => {}, setTimeout: () => 1,
    sh: { tend: () => ({}), league: () => 'cfb', SB_MS: 12000 },
    fetchGames: () => Promise.resolve([{ id: 'live', state: 'in' }]),
    renderPicker: () => {}, selectGame: id => selected.push(id)
  });
  const start = source.indexOf('function pollScoreboard(');
  vm.runInContext(source.slice(start, source.indexOf('function resetGame(', start)), c);
  c.pollScoreboard(true); await flush();
  assert.equal(c.st.games.length, 1);
  assert.equal(selected.length, 0);
});

function diagnostics() {
  let now = 100;
  const writes = [], intervals = [], listeners = {};
  const c = vm.createContext({
    DIAG_MAX: 500, LS: { diag: 'diag' }, lsGet: () => null,
    lsSet: (_, value) => writes.push(JSON.parse(value)), Date: { now: () => now },
    setInterval: (fn, ms) => intervals.push({ fn, ms }),
    window: { addEventListener: (key, fn) => { listeners[key] = fn; } },
    document: { visibilityState: 'visible', addEventListener: (key, fn) => { listeners[key] = fn; } }
  });
  vm.runInContext(source.slice(source.indexOf('var diagRing ='), source.indexOf('function diagPayload(')), c);
  return { c, writes, intervals, listeners, time: n => { now = n; } };
}

test('unchanged polls retain timing while corrections and resumed feeds stay distinct', () => {
  const h = diagnostics();
  h.c.diag('poll', { source_id: 'a', received_at: 100, response_gap_ms: 3000, resumed: false });
  h.time(3100);
  h.c.diag('poll', { source_id: 'a', received_at: 3100, response_gap_ms: 3200, resumed: false });
  assert.equal(h.c.diagRing.length, 1);
  assert.equal(h.c.diagRing[0].t, 100);
  assert.equal(h.c.diagRing[0].last_t, 3100);
  assert.equal(h.c.diagRing[0].polls, 2);
  assert.equal(h.c.diagRing[0].max_response_gap_ms, 3200);
  h.c.diag('poll', { source_id: 'a', received_at: 50000, response_gap_ms: 46900, resumed: true });
  h.c.diag('poll', { source_id: 'a', source_version: 2, revised: 1, received_at: 53000, response_gap_ms: 3000, resumed: false });
  h.c.diag('err', { where: 'summary' });
  assert.equal(h.c.diagRing.length, 4);
});

test('diagnostics persist on the 30-second timer and on leaving, without redundant writes', () => {
  const h = diagnostics();
  assert.equal(h.intervals[0].ms, 30000);
  h.c.diag('game', { id: 'a' });
  assert.equal(h.writes.length, 0);
  h.intervals[0].fn(); h.intervals[0].fn();
  assert.equal(h.writes.length, 1);
  h.c.diag('err', { where: 'summary' });
  h.c.document.visibilityState = 'hidden'; h.listeners.visibilitychange();
  assert.equal(h.writes.length, 2);
  h.c.diag('delay', 45); h.listeners.pagehide();
  assert.equal(h.writes.length, 3);
});

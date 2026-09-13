const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../web/app.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('college schedules request the verified FBS page size, not ESPN’s 25-game fallback', () => {
  const c = vm.createContext({ Date: { now: () => 123 }, sh: { API: 'https://example.test/',
    LEAGUES: { cfb: { path: 'college-football' }, nfl: { path: 'nfl' } } } });
  vm.runInContext(source.slice(source.indexOf('function scoreboardUrl('), source.indexOf('function summaryUrl(')), c);
  const college = new URL(c.scoreboardUrl('cfb', '20260912'));
  assert.equal(college.searchParams.get('groups'), '80');
  assert.equal(college.searchParams.get('limit'), '200');
  assert.equal(college.searchParams.get('dates'), '20260912');
  assert.equal(new URL(c.scoreboardUrl('nfl', '20260910')).searchParams.has('groups'), false);
});

function archive() {
  let league = 'cfb';
  const requests = [], timers = new Map(), date = { value: '2026-09-12' };
  const c = vm.createContext({
    AbortController, Date, st: { pickerMode: 'finished', archiveGames: [] },
    sh: { league: () => league, jget: (url, signal) => new Promise((resolve, reject) => requests.push({ url, signal, resolve, reject })) },
    $: () => date, renderPicker: () => {}, etDate: () => '20260913',
    scoreboardUrl: (lg, day) => lg + '/' + day, eventRow: e => e,
    setTimeout: (fn, ms) => { const id = Symbol(); timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(source.slice(source.indexOf('var archiveRequest ='), source.indexOf('// ---------------------------------------------------------------- plays')), c);
  return { c, requests, timers, date, setLeague: value => { league = value; } };
}

test('finished browsing filters unfinished games and does not change the selected live game', async () => {
  const h = archive(); h.c.st.gameId = 'live'; h.c.loadArchive();
  assert.equal(h.requests[0].url, 'cfb/20260912');
  h.requests[0].resolve({ events: [{ id: 'done', state: 'post' }, { id: 'live', state: 'in' }, { id: 'later', state: 'pre' }] });
  await flush();
  assert.deepEqual(Array.from(h.c.st.archiveGames, g => g.id), ['done']);
  assert.equal(h.c.st.gameId, 'live');
  assert.equal(h.c.st.archiveLoading, false);
  assert.equal(h.timers.size, 0);
});

test('date and league changes discard late archive replies even when abort is ignored', async () => {
  const h = archive(); h.c.loadArchive();
  h.date.value = '2026-09-10'; h.setLeague('nfl'); h.c.loadArchive();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.requests[1].url, 'nfl/20260910');
  h.requests[1].resolve({ events: [{ id: 'new', state: 'post' }] }); await flush();
  h.requests[0].resolve({ events: [{ id: 'old', state: 'post' }] }); await flush();
  assert.deepEqual(Array.from(h.c.st.archiveGames, g => g.id), ['new']);
  assert.equal(h.timers.size, 0);
});

test('leaving finished games prevents an old request or error from replacing the list', async () => {
  const h = archive(); h.c.loadArchive();
  h.c.st.pickerMode = 'current'; h.c.cancelArchive();
  h.requests[0].reject(new Error('late failure')); await flush();
  assert.equal(h.c.st.archiveError, '');
  assert.equal(h.c.st.archiveLoading, false);
  assert.equal(h.timers.size, 0);
});

test('missing schedules and network failures are errors, while empty schedules are valid', async () => {
  for (const value of [{}, null, { events: [] }]) {
    const h = archive(); h.c.loadArchive();
    if (value === null) h.requests[0].reject(new Error('network'));
    else h.requests[0].resolve(value);
    await flush();
    assert.equal(!!h.c.st.archiveError, !value || !value.events);
    assert.equal(h.c.st.archiveLoading, false);
  }
});

test('invalid or future archive dates do not request data', () => {
  for (const value of ['', '2026-02-30', '2026-09-14', 'oops']) {
    const h = archive(); h.date.value = value; h.c.loadArchive();
    assert.equal(h.requests.length, 0);
    assert.match(h.c.st.archiveError, /earlier date/);
  }
});

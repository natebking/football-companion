const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../web/roster-client.js');
const roster = require('../web/roster.js');
const start = Date.parse('2026-09-13T12:00:00Z');
const context = { league: 'nfl', season: 2026, teamIds: ['17'] };
function payload(teamId = '17', year = 2026) {
  return { team: { id: teamId }, season: { year }, coach: { name: 'Coach' }, athletes: [{ items: [
    { id: '1', fullName: 'Drake Maye', shortName: 'D. Maye', jersey: '10', status: { name: 'Active' }, stats: [1] }
  ] }] };
}
function cache(record) {
  let value = typeof record === 'string' ? record : JSON.stringify(record);
  return { getItem: () => value, setItem: (key, next) => { assert.equal(key, 'fc_rosters_v1'); value = next; }, read: () => JSON.parse(value) };
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
test('fetches once, provides scoped identity provenance, and persists only sanitized identity', async () => {
  let calls = 0, changes = 0;
  const storage = cache([]);
  const client = create({ fetchJSON: async (url, options) => { calls++; assert.ok(options.signal); assert.match(url, /nfl\/teams\/17\/roster\?season=2026$/); return payload(); }, storage, now: () => start, onChange: () => changes++ });
  await client.setContext(context);
  assert.equal(client.resolve('17', 'D.Maye').label, '#10 Drake Maye');
  assert.equal(client.resolve('17', '#9 D.Maye'), null);
  assert.equal(client.resolve('17', '#10 D.Maye').numberSource, 'report');
  assert.equal(client.resolve('17', 'D.Maye').roster.season, 2026);
  assert.equal(client.resolve('52', 'D.Maye'), null);
  assert.equal(changes, 1);
  const version = client.revision();
  await client.setContext(context);
  assert.equal(calls, 1); assert.equal(client.revision(), version);
  assert.ok(!JSON.stringify(storage.read()).includes('stats'));
  assert.ok(!JSON.stringify(storage.read()).includes('status'));
  client.clearContext(); assert.equal(client.resolve('17', 'D.Maye'), null);
});
test('deduplicates pending requests across reset and same-context steps', async () => {
  const task = deferred(); let calls = 0;
  const client = create({ fetchJSON: () => { calls++; return task.promise; }, now: () => start });
  const a = client.setContext(context);
  client.clearContext();
  const b = client.setContext(context);
  await Promise.resolve(); assert.equal(calls, 1);
  task.resolve(payload()); await Promise.all([a, b]);
  assert.equal(client.resolve('17', 'D.Maye').label, '#10 Drake Maye');
});
test('late cross-game completion caches without notifying or exposing stale players', async () => {
  const task = deferred(); let changes = 0;
  const client = create({ fetchJSON: url => url.includes('/17/') ? task.promise : Promise.resolve(payload('52')), now: () => start, onChange: () => changes++ });
  const old = client.setContext(context);
  await client.setContext({ league: 'cfb', season: 2026, teamIds: ['52'] });
  assert.equal(changes, 1);
  task.resolve(payload()); await old;
  assert.equal(changes, 1); assert.equal(client.resolve('17', 'D.Maye'), null);
  await client.setContext(context);
  assert.equal(client.resolve('17', 'D.Maye').roster.league, 'nfl');
});
test('valid persisted record avoids fetch; cached metadata is sanitized again', async () => {
  const saved = roster.fromResponse(payload(), { league: 'nfl', teamId: '17', season: 2026, retrievedAt: new Date(start).toISOString() });
  saved.stats = [2]; saved.athletes[0].injuries = [3];
  const client = create({ storage: cache([saved]), now: () => start, fetchJSON: () => { throw Error('should not fetch'); } });
  await client.setContext(context);
  const result = client.resolve('17', 'D.Maye');
  assert.equal(result.label, '#10 Drake Maye');
  assert.ok(!JSON.stringify(result).includes('injuries'));
});
test('bad, expired, future, wrong-schema and wrong-source caches never display', async () => {
  const valid = roster.fromResponse(payload(), { league: 'nfl', teamId: '17', season: 2026, retrievedAt: new Date(start).toISOString() });
  for (const saved of ['{', [{ ...valid, schemaVersion: 2 }], [{ ...valid, retrievedAt: new Date(start - 86400000).toISOString() }], [{ ...valid, retrievedAt: new Date(start + 1).toISOString() }], [{ ...valid, sourceUrl: 'wrong' }], [{ ...valid, teamId: '52' }]]) {
    const client = create({ storage: cache(saved), now: () => start, fetchJSON: async () => { throw Error('offline'); } });
    await client.setContext(context);
    assert.equal(client.resolve('17', 'D.Maye'), null);
  }
});
test('failed attempts remain quiet, back off five minutes and retry afterward', async () => {
  let time = start, calls = 0;
  const client = create({ now: () => time, fetchJSON: async () => { calls++; if (calls === 1) return payload('52'); return payload(); } });
  await client.setContext(context); await client.setContext(context);
  assert.equal(calls, 1); assert.equal(client.resolve('17', 'D.Maye'), null);
  time += 300000; await client.setContext(context);
  assert.equal(calls, 2); assert.ok(client.resolve('17', 'D.Maye'));
  const revision = client.revision();
  time += 86400000; assert.ok(client.revision() > revision);
  assert.equal(client.resolve('17', 'D.Maye'), null);
  await client.setContext(context); assert.equal(calls, 3);
});
test('timeout aborts after ten seconds even if transport ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const client = create({ now: () => start, fetchJSON: (url, options) => { signal = options.signal; return new Promise(() => {}); } });
  const job = client.setContext(context);
  await Promise.resolve();
  t.mock.timers.tick(10000); await job;
  assert.equal(signal.aborted, true);
  assert.equal(client.resolve('17', 'D.Maye'), null);
});
test('storage failures do not block successful lookup and persisted cache is bounded', async () => {
  const storage = cache([]);
  const client = create({ storage, now: () => start, fetchJSON: async url => payload(/\/teams\/(\d+)\//.exec(url)[1]) });
  await client.setContext({ ...context, teamIds: Array.from({ length: 30 }, (_, i) => String(i + 1)) });
  assert.equal(storage.read().length, 24);
  const broken = create({ storage: { getItem() { throw Error('denied'); }, setItem() { throw Error('full'); } }, now: () => start, fetchJSON: async () => payload() });
  await broken.setContext(context); assert.ok(broken.resolve('17', 'D.Maye'));
});

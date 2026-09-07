'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Practice = require('../web/practice.js');
const bank = require('../web/teaching-examples.json');
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const worked = bank.examples.find(e => e.id === 'short-throw-big-gain');

test('each question uses another game, with a versioned first answer and no live identity', () => {
  const s = storage(), p = Practice.create({ storage: s, now: () => 100 });
  p.seen(worked);
  const a = p.start(bank, worked.id, 'game');
  assert.notEqual(a.target.gameId, worked.gameId);
  assert.equal(a.priorExampleOpened, false);
  assert.equal(a.bankHash, bank.contentHash);
  assert.equal(a.level, 'game');
  assert.equal(a.journalKey, undefined);
  assert.equal(p.answer(a.id, 'unknown'), null);
  assert.equal(p.answer(a.id, 'throw').result, 'not_supported');
  assert.equal(p.answer(a.id, 'run'), null, 'The first answer is never overwritten.');
  const saved = JSON.parse(p.export());
  assert.equal(saved.attempts.length, 1);
  assert.equal(saved.attempts[0].choiceId, 'throw');
  assert.deepEqual(saved.attempts[0].pair, bank.practice[0]);
  assert.equal(saved.storageComplete, true);
});

test('prior viewing and repeat answers are retained across reloads; unsure is not an error', () => {
  const s = storage(), p = Practice.create({ storage: s });
  const a = p.start(bank, worked.id);
  assert.equal(p.answer(a.id, 'unsure').result, 'unsure');
  p.seen(bank.examples.find(e => e.id === a.target.id));
  const reloaded = Practice.create({ storage: s });
  const b = reloaded.start(bank, worked.id, 'basics');
  assert.equal(b.priorExampleOpened, true);
  assert.equal(b.priorQuestionAttempts, 1);
  assert.equal(b.priorTargetQuestions, 1);
  assert.equal(b.level, 'basics');
  assert.equal(reloaded.answer(b.id, b.pair.answerId).result, 'supported');
});

test('only answer opens are recorded as attempts; missing or same-game practice is rejected', () => {
  const p = Practice.create({ storage: storage() });
  p.seen(worked);
  assert.equal(JSON.parse(p.export()).attempts.length, 0);
  assert.equal(p.start(bank, 'not-in-bank'), null);
  const invalid = structuredClone(bank);
  invalid.examples.find(e => e.id === invalid.practice[0].testExampleId).gameId = worked.gameId;
  assert.equal(p.start(invalid, worked.id), null);
});

test('unreadable storage is preserved, and unsaved history cannot be called first exposure', () => {
  const s = storage(); s.setItem('ff_recognition_v1', '{broken');
  const p = Practice.create({ storage: s });
  const a = p.start(bank, worked.id);
  assert.equal(a.priorExampleOpened, null);
  assert.equal(a.priorQuestionAttempts, null);
  assert.equal(a.priorTargetQuestions, null);
  assert.equal(p.answer(a.id, 'run').result, 'supported');
  assert.equal(s.getItem('ff_recognition_v1'), '{broken');
  assert.equal(JSON.parse(p.export()).storageComplete, false);
});

test('a different question about an already opened target is still prior exposure', () => {
  const p = Practice.create({ storage: storage() });
  const first = p.start(bank, 'screen-behind-the-line');
  const second = p.start(bank, 'five-yards-third-down');
  assert.equal(first.target.playId, second.target.playId);
  assert.equal(second.priorQuestionAttempts, 0);
  assert.equal(second.priorExampleOpened, false);
  assert.equal(second.priorTargetQuestions, 1);
});

test('two open sessions preserve each other and clearing cannot relabel an old answer', () => {
  const s = storage(), p = Practice.create({ storage: s }), q = Practice.create({ storage: s });
  const a = p.start(bank, worked.id);
  const b = q.start(bank, worked.id);
  p.answer(a.id, 'run'); q.answer(b.id, 'throw');
  assert.equal(JSON.parse(p.export()).attempts.length, 2);
  assert.equal(q.clear(), true);
  const c = q.start(bank, worked.id);
  assert.equal(p.answer(a.id, 'run'), null);
  assert.notEqual(a.id, c.id);
  assert.equal(JSON.parse(p.export()).attempts.length, 1);
});

test('history has a limit and never silently removes an older attempt', () => {
  const p = Practice.create({ storage: storage() });
  for (let i = 0; i < 200; i++) assert.ok(p.start(bank, worked.id));
  assert.equal(p.start(bank, worked.id), null);
  assert.equal(p.status().full, true);
  assert.equal(JSON.parse(p.export()).attempts.length, 200);
});

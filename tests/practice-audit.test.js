'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Practice = require('../web/practice.js');
const { auditPractice } = require('../engine/practice_audit.js');
const bank = require('../web/teaching-examples.json');
function session() {
  const values = new Map(); let time = 100;
  const p = Practice.create({ storage: { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) }, now: () => time++ });
  return { p, audit: () => auditPractice(JSON.parse(p.export()), bank) };
}
test('practice audit separates first recorded, repeat, unsure and unanswered attempts', () => {
  const { p, audit } = session();
  const a = p.start(bank, 'short-throw-big-gain', 'game'); p.answer(a.id, a.pair.answerId);
  const b = p.start(bank, 'short-throw-big-gain', 'basics'); p.answer(b.id, 'unsure');
  p.start(bank, 'fake-handoff-deep-pass', 'game');
  const result = audit();
  assert.equal(result.summary.verifiedAnswered, 2); assert.equal(result.summary.verifiedUnanswered, 1);
  assert.deepEqual(result.rows.map(r => [r.exposure, r.result]), [['first_recorded', 'supported'], ['repeat', 'unsure'], ['first_recorded', null]]);
  assert.equal(result.groups[1].level, 'basics'); assert.equal(result.groups[1].not_supported, 0);
  assert.equal(result.learningGainsEstablished, false); assert.equal(result.uniqueViewers, null);
});
test('another question about the same target remains a repeat even when saved counters are wrong', () => {
  const { p } = session();
  p.start(bank, 'screen-behind-the-line'); p.start(bank, 'five-yards-third-down');
  const data = JSON.parse(p.export()); data.attempts[1].priorTargetQuestions = 0;
  assert.equal(auditPractice(data, bank).rows[1].exposure, 'repeat');
});
test('unknown prior history does not become first exposure, and later full viewing is not earlier exposure', () => {
  const { p } = session();
  const a = p.start(bank, 'short-throw-big-gain'); p.answer(a.id, a.pair.answerId);
  p.seen(bank.examples.find(e => e.id === a.target.id));
  const data = JSON.parse(p.export());
  assert.equal(auditPractice(data, bank).rows[0].exposure, 'first_recorded');
  delete data.attempts[0].priorTargetQuestions;
  assert.equal(auditPractice(data, bank).rows[0].exposure, 'unknown');
});
test('changed question, source facts, source identity or missing bank cannot be scored', () => {
  for (const change of [a => a.pair.question += ' changed', a => a.target.facts.gain = 99,
    a => a.target.gameId = 'other', a => a.bankHash = 'unavailable']) {
    const { p } = session(); const a = p.start(bank, 'short-throw-big-gain'); p.answer(a.id, a.pair.answerId);
    const data = JSON.parse(p.export()); change(data.attempts[0]);
    const report = auditPractice(data, bank);
    assert.equal(report.summary.verifiedAnswered, 0); assert.equal(report.summary.unverified, 1);
  }
});
test('invalid timing, answer or recorded grade is excluded and duplicate IDs reject the export', () => {
  const { p } = session(); const a = p.start(bank, 'short-throw-big-gain'); p.answer(a.id, a.pair.answerId);
  const data = JSON.parse(p.export());
  for (const change of [a => a.answeredAt = 0, a => a.choiceId = 'missing', a => a.result = 'not_supported']) {
    const d = structuredClone(data); change(d.attempts[0]);
    assert.equal(auditPractice(d, bank).summary.unverified, 1);
  }
  data.attempts.push(structuredClone(data.attempts[0]));
  assert.throws(() => auditPractice(data, bank), /duplicate attempt/);
});

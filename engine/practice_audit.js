/* Audit one browser's historical practice export. No learning-gain inference. */
'use strict';
const { isDeepStrictEqual } = require('node:util');
const sourceKey = e => [e?.league, e?.gameId, e?.playId].join(':');
const finiteTime = t => Number.isFinite(t) && t >= 0;
const count = n => Number.isInteger(n) && n >= 0;

function auditPractice(data, bank) {
  if (data.schemaVersion !== 1 || !data.seen || Array.isArray(data.seen) ||
      typeof data.seen !== 'object' || !Array.isArray(data.attempts) || typeof data.storageComplete !== 'boolean') {
    throw Error('Expected a downloaded practice export');
  }
  if (!bank.contentHash || !bank.version || !Array.isArray(bank.examples) || !Array.isArray(bank.practice)) throw Error('Expected the source example bank');
  const ids = new Set(), earlierTargets = new Set(), rows = [];
  for (const a of data.attempts) {
    if (!a.id || ids.has(a.id)) throw Error('Missing or duplicate attempt ID');
    ids.add(a.id);
    const key = sourceKey(a.target), reasons = [];
    let verifiedPair = null;
    const row = { id: a.id, pairId: a.pair?.id ?? null, bankHash: a.bankHash ?? null,
      level: a.level, status: 'unverified', exposure: 'unknown', result: null, reasons };
    const knownRepeat = a.priorExampleOpened === true || a.priorTargetQuestions > 0 ||
      a.priorQuestionAttempts > 0 || earlierTargets.has(key) ||
      (finiteTime(data.seen[key]) && data.seen[key] < a.openedAt);
    if (knownRepeat) row.exposure = 'repeat';
    else if (a.priorExampleOpened === false && a.priorTargetQuestions === 0 && a.priorQuestionAttempts === 0) row.exposure = 'first_recorded';
    earlierTargets.add(key);
    if (!finiteTime(a.openedAt)) reasons.push('invalid_open_time');
    if (!['basics', 'game'].includes(a.level)) reasons.push('unknown_level');
    if (![true, false, null].includes(a.priorExampleOpened) ||
        (a.priorTargetQuestions != null && !count(a.priorTargetQuestions)) ||
        (a.priorQuestionAttempts != null && !count(a.priorQuestionAttempts))) reasons.push('invalid_exposure_record');
    if (a.bankHash !== bank.contentHash || a.bankVersion !== bank.version) reasons.push('bank_unavailable');
    else {
      const pair = bank.practice.find(p => p.id === a.pair?.id);
      const target = bank.examples.find(e => e.id === pair?.testExampleId);
      const worked = bank.examples.find(e => e.id === pair?.workedExampleId);
      if (!pair || !target || !worked || !isDeepStrictEqual(a.pair, pair)) reasons.push('question_changed');
      else verifiedPair = pair;
      if (!target || !isDeepStrictEqual(a.target, { id: target.id, league: target.league,
        gameId: target.gameId, playId: target.playId, facts: target.facts, sources: target.sources })) reasons.push('target_evidence_changed');
      if (target && worked && target.league === worked.league && target.gameId === worked.gameId) reasons.push('same_game_example');
      row.workedExampleOpeningRecorded = worked && finiteTime(data.seen[sourceKey(worked)]) &&
        data.seen[sourceKey(worked)] <= a.openedAt ? true : null;
    }
    if (a.answeredAt == null) {
      if (a.choiceId != null || a.result != null) reasons.push('answer_without_time');
      if (!reasons.length) row.status = 'unanswered';
    } else {
      if (!finiteTime(a.answeredAt) || a.answeredAt < a.openedAt) reasons.push('invalid_answer_time');
      if (verifiedPair) {
        const validChoice = a.choiceId === 'unsure' || verifiedPair.choices.some(c => c.id === a.choiceId);
        if (!validChoice) reasons.push('unknown_choice');
        const result = a.choiceId === 'unsure' ? 'unsure' : a.choiceId === verifiedPair.answerId ? 'supported' : 'not_supported';
        if (a.result !== result) reasons.push('saved_result_mismatch');
        if (!reasons.length) { row.status = 'answered'; row.result = result; }
      }
    }
    rows.push(row);
  }
  const groups = new Map();
  for (const r of rows) {
    if (r.status === 'unverified') continue;
    const key = JSON.stringify([r.pairId, r.level, r.exposure]);
    if (!groups.has(key)) groups.set(key, { pairId: r.pairId, level: r.level, exposure: r.exposure,
      opened: 0, unanswered: 0, supported: 0, not_supported: 0, unsure: 0 });
    const g = groups.get(key); g.opened++;
    g[r.result || 'unanswered']++;
  }
  const exclusions = {};
  for (const r of rows) for (const reason of r.reasons) exclusions[reason] = (exclusions[reason] || 0) + 1;
  return { schemaVersion: 1, scope: 'One browser export; historical evidence interpretation',
    storageComplete: data.storageComplete, summary: { recordedAttempts: rows.length,
      verifiedAnswered: rows.filter(r => r.status === 'answered').length,
      verifiedUnanswered: rows.filter(r => r.status === 'unanswered').length,
      unverified: rows.filter(r => r.status === 'unverified').length, exclusions },
    groups: [...groups.values()], rows, uniqueViewers: null, learningGainsEstablished: false,
    limitations: ['First recorded means within available browser history, not a person’s first exposure.',
      'Opening an example does not establish that it was read.',
      'Answers interpret supplied facts; they do not test video recognition.',
      'There is no before/after or comparison-group measure of learning.',
      'Browser exports do not identify distinct people and must not be pooled as independent viewers.'] };
}
module.exports = { auditPractice };

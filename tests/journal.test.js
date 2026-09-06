const test = require('node:test');
const assert = require('node:assert/strict');
const { create, compare } = require('../web/journal');
const { describe } = require('../web/play-facts');
const fixtures = require('./fixtures/play-facts.json');
function setup(options = {}) {
  const values = new Map(); let writes = 0, quota = false, clock = 100;
  const storage = { getItem: k => values.get(k) || null, setItem: (k, v) => { if (quota) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } writes++; values.set(k, v); }, removeItem: k => values.delete(k) };
  const journal = create({ storage, now: () => clock, ...options });
  const meta = { league: 'cfb', gameId: '401858432', label: 'BALL at OSU', status: 'in' };
  const key = journal.beginGame(meta).key;
  return { journal, key, meta, values, storage, writes: () => writes, quota: v => { quota = v; }, time: v => { clock = v; } };
}
function run() { return structuredClone(fixtures.normalRun.play); }
function review(report = run()) { return { schemaVersion: 1, key: 'cfb:401858432', gameId: '401858432', league: 'cfb', status: 'final',
  teams: Object.entries(fixtures.normalRun.abbr).map(([id, abbreviation]) => ({ id, abbreviation })), plays: [{ id: String(report.id), report }] }; }
function shownPlay(s, report = run(), extra = {}) {
  s.journal.recordSource(s.key, { report, observedAt: 100, releasedAt: 110 });
  return s.journal.recordShown(s.key, { kind: 'play', playId: String(report.id), report, shownAt: 110,
    facts: describe(report, fixtures.normalRun.abbr), ...extra });
}
function guidance(s, at = 50, extra = {}) {
  return s.journal.recordShown(s.key, { kind: 'guidance', shownAt: at, visibility: 'visible', probabilityShown: .58,
    modelProbability: .59, baselineProbability: .54, lines: { tendency: 'They run here 42% of the time.' }, ...extra });
}
function resolve(s, shown, report = run()) {
  s.journal.recordSource(s.key, { report, observedAt: 100, releasedAt: 110 });
  s.journal.recordObservation(s.key, { kind: 'resolution', shownId: shown.id, playId: String(report.id), at: 110 });
}

test('unchanged game metadata dedupes without another storage write', () => {
  const s = setup(), n = s.writes();
  assert.equal(s.journal.beginGame(s.meta).ok, true);
  assert.equal(s.writes(), n);
});
test('source batches make one durable write and dedupe repeated reports', () => {
  const s = setup(), n = s.writes(), report = run();
  assert.equal(s.journal.recordSources(s.key, [{ report, observedAt: 100 }, { report, observedAt: 101 }]).ok, true);
  assert.equal(s.writes(), n + 1);
  assert.equal(s.journal.loadGame(s.key).sources.length, 1);
  s.journal.recordSource(s.key, { report, observedAt: 102 });
  assert.equal(s.writes(), n + 1);
});
test('corrections and content reversions retain immutable revisions and release chronology', () => {
  const s = setup(), a = run(), b = run(); b.text = 'Corrected report';
  const one = s.journal.recordSource(s.key, { report: a, observedAt: 100 });
  const two = s.journal.recordSource(s.key, { report: b, observedAt: 120 });
  const three = s.journal.recordSource(s.key, { report: a, observedAt: 140 });
  s.journal.recordSource(s.key, { report: b, observedAt: 120, releasedAt: 150 });
  const game = s.journal.loadGame(s.key);
  assert.equal(game.sources.length, 3);
  assert.notEqual(one.revisionId, three.revisionId);
  assert.equal(game.releases[0].revisionId, two.revisionId);
  assert.equal(game.sources[0].report.text, a.text);
});
test('shown wording and exact report revision survive later input mutation and reload', () => {
  const s = setup(), report = run(), saved = shownPlay(s, report);
  report.text = 'mutated externally';
  const reloaded = create({ storage: s.storage }), game = reloaded.loadGame(s.key);
  assert.equal(game.shown[0].id, saved.id);
  assert.equal(game.shown[0].revisionId, game.sources[0].revisionId);
  assert.equal(game.shown[0].facts.summary, 'Run for 4 yards.');
  assert.equal(game.shown[0].report, undefined);
  game.shown[0].facts.summary = 'another mutation';
  assert.equal(reloaded.loadGame(s.key).shown[0].facts.summary, 'Run for 4 yards.');
});
test('quota errors leave existing evidence intact and are exposed instead of evicting', () => {
  const s = setup(); shownPlay(s); const before = s.journal.exportGame(s.key);
  s.quota(true);
  assert.equal(s.journal.recordObservation(s.key, { kind: 'learning', choice: 'unsure' }).ok, false);
  assert.equal(s.journal.status().code, 'quota');
  assert.equal(s.journal.exportGame(s.key), before);
});
test('game count and size caps fail explicitly without deleting older games', () => {
  const s = setup({ maxGames: 1, maxGameBytes: 3000 });
  assert.equal(s.journal.beginGame({ ...s.meta, gameId: '401858433' }).code, 'game_count');
  assert.equal(s.journal.recordShown(s.key, { text: 'x'.repeat(2000) }).code, 'game_limit');
  assert.equal(s.journal.listGames().length, 1);
  assert.equal(s.journal.loadGame(s.key).shown.length, 0);
});
test('invalid batches roll back and reports cannot release before receipt', () => {
  const s = setup();
  const result = s.journal.recordSources(s.key, [{ report: run() }, { report: { text: 'no id' } }]);
  assert.equal(result.ok, false);
  assert.equal(s.journal.loadGame(s.key).sources.length, 0);
  assert.equal(s.journal.recordSource(s.key, { report: run(), observedAt: 100, releasedAt: 99 }).code, 'invalid_time');
});
test('observations preserve their exact prompt link, and unknown links are rejected', () => {
  const s = setup(), p = guidance(s);
  assert.equal(s.journal.recordObservation(s.key, { shownId: p.id, choice: 'run' }).ok, true);
  assert.equal(s.journal.recordObservation(s.key, { shownId: 'missing', choice: 'run' }).code, 'unknown_prompt');
  assert.equal(s.journal.loadGame(s.key).observations[0].shownId, p.id);
});
test('export, explicit deletion and corrupted storage have predictable behavior', () => {
  const s = setup(); shownPlay(s);
  assert.equal(JSON.parse(s.journal.exportGame(s.key)).sources.length, 1);
  assert.equal(s.journal.removeGame(s.key).ok, true);
  assert.deepEqual(s.journal.listGames(), []);
  s.values.set('ff_journal_v1_index', 'broken');
  assert.equal(s.journal.beginGame(s.meta).ok, false);
  assert.equal(s.values.get('ff_journal_v1_index'), 'broken');
});
test('a finished review must match the exact league and game', () => {
  const s = setup(); shownPlay(s);
  assert.equal(compare(s.journal.loadGame(s.key), { ...review(), key: 'nfl:401858432' }).available, false);
  assert.equal(compare(s.journal.loadGame(s.key), { ...review(), status: 'in' }).available, false);
});
test('next-down, player and direction changes cannot be called consistent', () => {
  const s = setup(); shownPlay(s);
  const final = run(); final.end.distance = 5; final.text = final.text.replace('B.Jackson', 'C.Runner').replace('rush middle', 'rush right');
  const result = compare(s.journal.loadGame(s.key), review(final));
  assert.equal(result.summary.changed, 1);
  assert.ok(result.plays[0].changes.some(c => c.field === 'consequence'));
  assert.ok(result.plays[0].changes.some(c => c.field === 'players'));
  assert.ok(result.plays[0].changes.some(c => c.field === 'facts'));
});
test('newly available catch components are enrichment rather than an earlier false claim', () => {
  const s = setup(), report = structuredClone(fixtures.normalPass.play);
  report.text = report.text.replace('caught at BallSt50, ', '');
  shownPlay(s, report);
  const final = review(report); final.plays[0].enrichment = { passing: { airYards: 3, yardsAfterCatch: 9, yardageVerified: true } };
  const result = compare(s.journal.loadGame(s.key), final);
  assert.equal(result.plays[0].status, 'enriched');
  assert.equal(result.summary.changed, 0);
  assert.equal(result.summary.enriched, 1);
});
test('loaded history, covered renders and unshown source revisions do not become watched explanations', () => {
  const s = setup(); shownPlay(s, run(), { historicalOnArrival: true });
  shownPlay(s, run(), { visibility: 'covered' });
  s.journal.recordSource(s.key, { report: { ...run(), id: 'future' }, observedAt: 500 });
  assert.equal(compare(s.journal.loadGame(s.key), review()).summary.shownPlays, 0);
});
test('probabilities link only before first receipt, once per play, without numerical scoring', () => {
  const s = setup(), first = guidance(s, 20), latest = guidance(s, 50);
  resolve(s, first); resolve(s, latest);
  const result = compare(s.journal.loadGame(s.key), review());
  assert.equal(result.summary.linked, 1);
  assert.equal(result.predictions[1].status, 'linked');
  assert.equal(result.predictions[1].probability, .58);
  assert.equal(result.predictions[1].eligibleForEvaluation, false);
  assert.equal('brier' in result.summary, false);
  assert.equal(result.predictions.some(p => 'brier' in p || 'baselineBrier' in p), false);
});
test('guidance after receipt, hidden prompts and missing exact links are never evaluated', () => {
  for (const entry of [{ shownAt: 101 }, { visibility: 'background' }, { probabilityShown: null }]) {
    const s = setup(), prompt = guidance(s, 50, entry); resolve(s, prompt);
    assert.equal(compare(s.journal.loadGame(s.key), review()).summary.linked, 0);
  }
  const s = setup(); guidance(s); s.journal.recordSource(s.key, { report: run(), observedAt: 100 });
  assert.equal(compare(s.journal.loadGame(s.key), review()).summary.linked, 0);
});
test('sacks and nullified plays never inherit run/throw quiz scoring', () => {
  for (const name of ['sack', 'nullifiedTouchdown', 'interception']) {
    const s = setup(), prompt = guidance(s), report = structuredClone(fixtures[name].play); resolve(s, prompt, report);
    const result = compare(s.journal.loadGame(s.key), review(report));
    assert.equal(result.summary.linked, 0, name);
    assert.equal(result.predictions[0].eligibleForEvaluation, false, name);
    assert.equal('brier' in result.predictions[0], false, name);
  }
});

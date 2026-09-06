const test = require('node:test');
const assert = require('node:assert/strict');
const { auditGame } = require('../engine/journal_audit.js');
const insights = require('../web/game-insights.js');
const read = require('../web/game-read.js');
function fixture() {
  const sources = [1, 2, 3].map(id => ({ revisionId: id + ':1', playId: String(id), observedAt: 1000,
    report: { id: String(id), driveId: 'drive-' + id, type: { text: 'Pass Incompletion' },
      text: '#4 M.Madsen pass incomplete short right to #19 R.Jones', statYardage: 0,
      start: { down: 3, distance: 8, team: { id: '68' }, yardsToEndzone: 70, possessionText: 'BOIS 30' },
      end: { down: 4, distance: 8, team: { id: '68' }, yardsToEndzone: 70, possessionText: 'BOIS 30' } } }));
  const situation = { gameId: '123', down: 3, distance: 8, yardsToGoal: 70,
    period: 1, clockSeconds: 600, scoreDiff: 0, offenseTeam: { id: '68' } };
  const evidence = insights.forRead(insights.summarize(sources.map(s => s.report), { teamAbbreviations: { 68: 'BOIS' } }), '123');
  const c = read.select(situation, evidence);
  return { schemaVersion: 1, key: 'cfb:123', meta: { gameId: '123', league: 'cfb', teams: [{ id: '68', abbreviation: 'BOIS' }] }, sources,
    releases: sources.map(s => ({ revisionId: s.revisionId, playId: s.playId, at: 1100 })),
    shown: [{ id: 'shown:1', kind: 'guidance', shownAt: 1500, basisPlayId: '3', basisRevision: 1,
      visibility: 'visible', situation, cardId: c.id, read: c,
      lines: { watch: c.headline, detail: c.detail, observation: c.watch } }], observations: [] };
}
test('audit reproduces an observed insight from only the reports released before it', () => {
  const game = fixture();
  const correction = structuredClone(game.sources[0]); correction.observedAt = 1200; correction.revisionId = '1:2';
  correction.report.text = 'PENALTY. NO PLAY'; correction.report.type.text = 'Penalty';
  game.sources.push(correction); game.releases.push({ revisionId: '1:2', playId: '1', at: 1600 });
  const report = auditGame(game);
  assert.equal(report.summary.reproduced, 1);
  assert.equal(report.summary.unsupportedByReleasedReports, 0);
  assert.equal(report.rows[0].proposedRead, 'third_down_target');
  assert.equal(report.rows[0].predictionScored, false);
  assert.equal(report.finalComparison, null);
});
test('a claim based on an unreleased report is a failure even if the source had arrived', () => {
  const game = fixture(); game.releases[2].at = 2000;
  const report = auditGame(game);
  assert.equal(report.summary.notReproduced, 1);
  assert.equal(report.summary.unsupportedByReleasedReports, 1);
  assert.deepEqual(report.rows[0].missingSupport, ['3']);
});
test('different selector versions are not reported as verified', () => {
  const game = fixture(); game.shown[0].read.version = 'an-older-version';
  const report = auditGame(game);
  assert.equal(report.summary.reproduced, 0);
  assert.equal(report.summary.notReproduced, 0);
  assert.equal(report.summary.unverifiableVersion, 1);
});
test('covered or background prompts are not counted as visible learning moments', () => {
  const game = fixture(); game.shown[0].visibility = 'background';
  assert.equal(auditGame(game).summary.visibleGuidanceMoments, 0);
});
test('a disclosure re-render is not another prompt, and the last rating wins for the moment', () => {
  const game = fixture();
  game.shown.push({ ...structuredClone(game.shown[0]), id: 'shown:2', shownAt: 1501 });
  game.observations = [{ kind: 'read_feedback', shownId: 'shown:1', rating: 'useful' },
    { kind: 'read_feedback', shownId: 'shown:2', rating: 'obvious' }];
  const report = auditGame(game);
  assert.equal(report.summary.visibleGuidanceMoments, 1);
  assert.deepEqual(report.summary.feedback, { useful: 0, obvious: 1, unsupported: 0 });
});
test('candidate cooldown uses its own selections, including saved background moments', () => {
  const game = fixture();
  delete game.shown[0].read;
  game.shown[0].visibility = 'background';
  game.shown.push({ ...structuredClone(game.shown[0]), id: 'shown:2', shownAt: 1501,
    visibility: 'visible', basisPlayId: '4' });
  const report = auditGame(game);
  assert.equal(report.summary.replayedGuidanceMoments, 2);
  assert.equal(report.summary.visibleGuidanceMoments, 1);
  assert.equal(report.rows[0].recordedRead, null);
  assert.equal(report.rows[0].proposedRead, 'third_down_distance', 'The third-down target candidate was already used in the background.');
});
test('repetition checks use the compact metadata saved by the real browser', () => {
  const game = fixture();
  delete game.shown[0].read.priority;
  game.shown.push({ ...structuredClone(game.shown[0]), id: 'shown:2', shownAt: 1501, basisPlayId: '4' });
  assert.equal(auditGame(game).summary.repeatedWithinSixMoments, 1);
});
test('invalid source relationships and duplicate records fail explicitly', () => {
  for (const mutate of [
    g => g.sources.push(g.sources[0]), g => g.releases[0].revisionId = 'missing',
    g => g.releases[0].at = 900, g => g.shown.push(g.shown[0])
  ]) { const game = fixture(); mutate(game); assert.throws(() => auditGame(game)); }
  assert.throws(() => auditGame({ status: 'final', plays: [] }));
});

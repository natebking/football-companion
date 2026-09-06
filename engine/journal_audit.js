/* Replay exported journals with the data that had actually been released.
 * Final reports audit corrections, never supply pre-snap predictor inputs. */
'use strict';
const insights = require('../web/game-insights.js');
const read = require('../web/game-read.js');
const journal = require('../web/journal.js');

function auditGame(game, review) {
  if (!game || game.schemaVersion !== 1 || !Array.isArray(game.shown) || !Array.isArray(game.sources) || !Array.isArray(game.releases)) {
    throw new Error('Expected a downloaded game journal, not a final review or a diagnostic log.');
  }
  const sources = new Map(), shownIds = new Set();
  for (const row of game.sources) {
    if (!row.revisionId || sources.has(row.revisionId)) throw new Error('Missing or duplicate source revision ID');
    sources.set(row.revisionId, row);
  }
  for (const row of game.shown) {
    if (!row.id || shownIds.has(row.id)) throw new Error('Missing or duplicate shown ID');
    shownIds.add(row.id);
  }
  const releases = game.releases.slice().sort((a, b) => a.at - b.at);
  for (const release of releases) {
    const source = sources.get(release.revisionId);
    if (!source || String(source.playId) !== String(release.playId) || !Number.isFinite(release.at)) throw new Error('Invalid release reference or time');
    if (!Number.isFinite(source.observedAt) || source.observedAt > release.at) throw new Error('Source arrival must precede release');
  }
  const abbr = Object.fromEntries((game.meta.teams || []).map(t => [String(t.id), t.abbreviation]));
  const feedback = new Map();
  for (const entry of game.observations || []) {
    if (entry.kind === 'read_feedback' && shownIds.has(entry.shownId) && ['useful', 'obvious', 'unsupported'].includes(entry.rating)) feedback.set(entry.shownId, entry.rating);
  }
  const visible = game.shown.filter(s => s.kind === 'guidance' && s.visibility === 'visible');
  const retained = new Map(), history = [], rows = [], evaluated = new Set();
  let cursor = 0;
  for (const shown of visible.slice().sort((a, b) => (a.shownAt ?? a.at) - (b.shownAt ?? b.at))) {
    const at = shown.shownAt ?? shown.at;
    if (!Number.isFinite(at)) throw new Error('Guidance is missing its display time');
    while (cursor < releases.length && releases[cursor].at <= at) {
      const release = releases[cursor++], source = sources.get(release.revisionId);
      retained.set(String(release.playId), source.report);
    }
    // Expanding a source disclosure does not create another teaching moment.
    const moment = String(shown.basisPlayId) + '|' + String(shown.basisRevision) + '|' +
      (shown.read ? shown.read.key : shown.cardId) + '|' + JSON.stringify(shown.situation);
    if (evaluated.has(moment)) continue;
    evaluated.add(moment);
    const summary = insights.summarize([...retained.values()], { teamAbbreviations: abbr });
    const evidence = insights.forRead(summary, game.meta.gameId);
    const proposed = read.select(shown.situation, evidence, history);
    const eligible = read.candidates(shown.situation, evidence);
    const recorded = shown.read;
    const missingSupport = recorded ? (recorded.playIds || []).filter(id => !retained.has(String(id))) : [];
    const sameVersion = recorded && recorded.version === read.version;
    const reproducible = sameVersion ? eligible.some(c => c.key === recorded.key &&
      c.headline === shown.lines.watch && c.detail === shown.lines.detail && c.watch === shown.lines.observation) : null;
    const repeated = !!recorded && history.slice(-6).includes(recorded.key) && recorded.id !== 'fourth_down';
    rows.push({ shownId: shown.id, at, basisPlayId: shown.basisPlayId, recordedRead: recorded ? recorded.id : null,
      proposedRead: proposed ? proposed.id : null, sameVersion: !!sameVersion,
      reproducible, missingSupport, repeated, feedback: feedback.get(shown.id) || null,
      releasedReports: retained.size, predictionScored: false });
    history.push(recorded ? recorded.key : 'quiet');
  }
  const comparison = journal.compare(game, review);
  return {
    schemaVersion: 1, game: game.key, selectorVersion: read.version,
    timingBasis: 'Recorded source arrivals, release times and visible guidance. Final data is used only for the correction comparison.',
    summary: { visibleGuidanceMoments: rows.length, recordedReads: rows.filter(r => r.recordedRead).length,
      reproduced: rows.filter(r => r.reproducible === true).length,
      notReproduced: rows.filter(r => r.reproducible === false).length,
      unverifiableVersion: rows.filter(r => !r.sameVersion && r.recordedRead).length,
      unsupportedByReleasedReports: rows.filter(r => r.missingSupport.length).length,
      repeatedWithinSixMoments: rows.filter(r => r.repeated).length,
      feedback: Object.fromEntries(['useful', 'obvious', 'unsupported'].map(rating => [rating, [...feedback.values()].filter(r => r === rating).length])) },
    finalComparison: comparison.available ? comparison.summary : null,
    finalComparisonUnavailable: comparison.available ? null : comparison.reason,
    rows,
    limitations: [
      'This checks evidence and repetition. It does not establish learning or prediction accuracy.',
      'Feedback is voluntary and describes the people who submitted journals, not all viewers.',
      'Future candidate changes must be selected on earlier games and evaluated on untouched later games.',
      'No saved live journal means the original live experience cannot be reconstructed from a final report.'
    ]
  };
}
module.exports = { auditGame };

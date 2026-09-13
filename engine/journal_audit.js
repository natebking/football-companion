/* Replay exported journals with the data that had actually been released.
 * Final reports audit corrections, never supply pre-snap predictor inputs. */
'use strict';
const insights = require('../web/game-insights.js');
const read = require('../web/game-read.js');
const journal = require('../web/journal.js');
const history = require('../web/game-history.js');
const display = require('../web/player-display.js');

function auditGame(game, review, historyData) {
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
  const moments = new Map(), momentByShownId = new Map();
  const guidance = game.shown.filter(s => s.kind === 'guidance').slice()
    .sort((a, b) => (a.shownAt ?? a.at) - (b.shownAt ?? b.at));
  for (const shown of guidance) {
    if (!Number.isFinite(shown.shownAt ?? shown.at)) throw new Error('Guidance is missing its display time');
    // A disclosure or visibility change does not select a new card.
    const key = String(shown.basisPlayId) + '|' + String(shown.basisRevision) + '|' +
      (shown.read ? shown.read.key : shown.cardId) + '|' + JSON.stringify(shown.situation);
    if (!moments.has(key)) moments.set(key, { shown, visible: false, feedback: null });
    const moment = moments.get(key);
    moment.visible ||= shown.visibility === 'visible';
    momentByShownId.set(shown.id, moment);
  }
  // The last rating for a teaching moment wins, even across disclosure renders.
  for (const entry of (game.observations || []).slice().sort((a, b) => (a.at || 0) - (b.at || 0))) {
    const moment = momentByShownId.get(entry.shownId);
    if (entry.kind === 'read_feedback' && moment && ['useful', 'obvious', 'unsupported'].includes(entry.rating)) moment.feedback = entry.rating;
  }
  const retained = new Map(), recordedHistory = [], proposedHistory = [], rows = [];
  let cursor = 0, lastShown = null, lastRecorded = null, lastProposed = null;
  for (const moment of moments.values()) {
    const shown = moment.shown;
    const at = shown.shownAt ?? shown.at;
    while (cursor < releases.length && releases[cursor].at <= at) {
      const release = releases[cursor++], source = sources.get(release.revisionId);
      retained.set(String(release.playId), source.report);
    }
    const summary = insights.summarize([...retained.values()], { teamAbbreviations: abbr });
    const evidence = insights.forRead(summary, game.meta.gameId);
    const past = history.lookup(historyData, shown.situation, game.meta.league);
    const refresh = shown.selectionReason === 'context' && lastShown && shown.basisPlayId === lastShown.basisPlayId &&
      shown.situation.sitKey === lastShown.situation.sitKey;
    const proposed = read.select(shown.situation, evidence, refresh && lastProposed ? proposedHistory.filter(key => key !== lastProposed.key) : proposedHistory, past);
    const eligible = read.candidates(shown.situation, evidence, past);
    const recorded = shown.read;
    const refs = recorded && recorded.historyRefs || [];
    const historyAvailable = refs.every(ref => past && ref.datasetId === past.datasetId && ref.season === past.season && ref.key === past.key &&
      past.rows.some(row => row.side === ref.side && row.team === ref.team));
    const missingSupport = recorded ? (recorded.playIds || []).filter(id => !retained.has(String(id))) : [];
    const sameVersion = recorded && recorded.version === read.version;
    // Reproduce the display with the labels saved at that moment. Identity
    // metadata is not an additional report, a player count or a forecast input.
    const resolveLabel = (teamId, name) => (recorded && recorded.identities || []).find(item =>
      item.reportedName === name && item.roster && item.roster.teamId === teamId &&
      item.roster.league === game.meta.league && item.roster.season === shown.situation.season &&
      Date.parse(item.roster.retrievedAt) <= at) || null;
    const reproducible = sameVersion && historyAvailable ? eligible.some(c => {
      const view = display.read(c, shown.situation.offenseTeam && shown.situation.offenseTeam.id, resolveLabel);
      return c.key === recorded.key && view.headline === shown.lines.watch && view.detail === shown.lines.detail &&
        view.watch === shown.lines.observation && view.playerContext === (shown.lines.playerContext || '') &&
        JSON.stringify(c.supportingPlayer || null) === JSON.stringify(recorded.supportingPlayer || null);
    }) : null;
    const repeated = !!recorded && !(refresh && lastRecorded && recorded.key === lastRecorded.key) && recordedHistory.slice(-6).includes(recorded.key) &&
      !['fourth_down', 'protect_clock', 'chasing_score'].includes(recorded.id);
    if (moment.visible) rows.push({ shownId: shown.id, at, basisPlayId: shown.basisPlayId, recordedRead: recorded ? recorded.id : null,
      proposedRead: proposed ? proposed.id : null, sameVersion: !!sameVersion,
      reproducible, missingSupport, historyAvailable, refreshedContext: !!refresh, repeated, feedback: moment.feedback,
      releasedReports: retained.size, predictionScored: false });
    if (!refresh || (recorded && recorded.key) !== (lastRecorded && lastRecorded.key)) recordedHistory.push(recorded ? recorded.key : 'quiet');
    if (!refresh || (proposed && proposed.key) !== (lastProposed && lastProposed.key)) proposedHistory.push(proposed ? proposed.key : 'quiet');
    lastShown = shown; lastRecorded = recorded; lastProposed = proposed;
  }
  const comparison = journal.compare(game, review);
  return {
    schemaVersion: 1, game: game.key, selectorVersion: read.version,
    timingBasis: 'Replay all distinct saved guidance moments, including background selections, with separate candidate cooldown history. Report moments recorded visible. Final data is used only for the correction comparison.',
    summary: { replayedGuidanceMoments: moments.size, visibleGuidanceMoments: rows.length, recordedReads: rows.filter(r => r.recordedRead).length,
      reproduced: rows.filter(r => r.reproducible === true).length,
      notReproduced: rows.filter(r => r.reproducible === false).length,
      unverifiableVersion: rows.filter(r => !r.sameVersion && r.recordedRead).length,
      unverifiableHistory: rows.filter(r => !r.historyAvailable).length,
      unsupportedByReleasedReports: rows.filter(r => r.missingSupport.length).length,
      repeatedWithinSixMoments: rows.filter(r => r.repeated).length,
      feedback: Object.fromEntries(['useful', 'obvious', 'unsupported'].map(rating => [rating, rows.filter(r => r.feedback === rating).length])) },
    finalComparison: comparison.available ? comparison.summary : null,
    finalComparisonUnavailable: comparison.available ? null : comparison.reason,
    rows,
    limitations: [
      'This checks evidence and repetition. It does not establish learning or prediction accuracy.',
      'Roster labels replay saved identity metadata; the audit does not independently verify the roster or the game-day lineup.',
      'Candidate proposals replay saved guidance moments, not every browser event. They are an offline comparison, not proof of a full runtime replay.',
      'Feedback is voluntary and describes the people who submitted journals, not all viewers.',
      'Future candidate changes must be selected on earlier games and evaluated on untouched later games.',
      'No saved live journal means the original live experience cannot be reconstructed from a final report.'
    ]
  };
}
module.exports = { auditGame };

/* Counterfactual forecasts from saved inputs. Final labels only check outcomes. */
'use strict';
const context = require('../web/context-model.js');
const history = require('../web/game-history.js');

function baselineProbability(table, input) {
  const { down, distance, yardsToGoal: y } = input;
  if (!Number.isInteger(down) || down < 1 || down > 4 || !Number.isInteger(distance) || distance < 1 || distance > 99 || !Number.isInteger(y) || y < 1 || y > 99) return null;
  // Same fixed situation buckets as export_tables.lookup and the live reader.
  const key = 'd' + down + '_' + (distance <= 3 ? 'short' : distance <= 7 ? 'medium' : 'long') + '_' +
    (y >= 80 ? 'own_deep' : y >= 60 ? 'own' : y >= 40 ? 'mid' : y >= 20 ? 'opp' : 'red');
  const team = table.teams[input.team]?.[key];
  const league = table.league_baseline[key]?.pass_rate ?? table.league_overall.pass_rate;
  return team?.can_attribute ? team.pass_rate : league;
}

function replay(game, labels, candidate, baseline, freeze) {
  if (game.schemaVersion !== 1 || !Array.isArray(game.shown) || !Array.isArray(game.sources) || !Array.isArray(game.releases)) throw Error('Expected a saved journal');
  const league = game.meta.league, frozenAt = Date.parse(freeze.frozenAt);
  if (!['nfl', 'cfb'].includes(league) || game.key !== league + ':' + game.meta.gameId) throw Error('Journal game identity is inconsistent');
  if (!Number.isFinite(frozenAt) || candidate.league !== league || baseline.league !== league ||
      candidate.throughSeason !== freeze.targetSeason - 1 || Math.max(...baseline.seasons) !== candidate.throughSeason) throw Error('Freeze does not match the league and training horizon');
  if (labels.kind !== 'aligned-final-labels' || labels.key !== game.key || labels.season !== freeze.targetSeason || !labels.sourceSha256) throw Error('Exact-game, source-aligned final labels are required');
  const sources = new Map(), arrivals = new Map(), releases = new Map(), shownIds = new Set(), resolutionIds = new Map();
  for (const s of game.sources) {
    if (!s.revisionId || !s.playId || sources.has(s.revisionId) || s.report?.id == null || String(s.report.id) !== String(s.playId) || !Number.isFinite(s.observedAt)) throw Error('Invalid source identity or arrival');
    sources.set(s.revisionId, s);
    arrivals.set(String(s.playId), Math.min(arrivals.get(String(s.playId)) ?? Infinity, s.observedAt));
  }
  for (const r of game.releases) {
    const s = sources.get(r.revisionId);
    if (!s || String(s.playId) !== String(r.playId) || !Number.isFinite(r.at) || r.at < s.observedAt) throw Error('Invalid source release');
    releases.set(r.revisionId, Math.min(releases.get(r.revisionId) ?? Infinity, r.at));
  }
  for (const r of game.observations || []) {
    if (r.kind !== 'resolution' || !r.shownId || !r.playId) continue;
    if (!resolutionIds.has(r.shownId)) resolutionIds.set(r.shownId, new Set());
    resolutionIds.get(r.shownId).add(String(r.playId));
  }
  const teamKeys = Object.fromEntries(Object.keys(candidate.teams).map(k => [k.split('|')[0], true]));
  const rows = [], selected = new Map();
  for (const shown of game.shown.filter(s => s.kind === 'guidance').slice().sort((a, b) => (a.shownAt ?? a.at) - (b.shownAt ?? b.at))) {
    if (!shown.id || shownIds.has(shown.id)) throw Error('Duplicate or missing guidance ID');
    shownIds.add(shown.id);
    const at = shown.shownAt ?? shown.at, s = shown.situation || {};
    const links = new Set(resolutionIds.get(shown.id) || []);
    if (shown.targetPlayId) links.add(String(shown.targetPlayId));
    const target = links.size === 1 ? [...links][0] : null;
    const input = { league, team: history.teamKey(s.offenseTeam, league, teamKeys) || '',
      down: s.down, distance: s.distance, yardsToGoal: s.yardsToGoal, period: s.period,
      clockSeconds: s.clockSeconds, scoreDiff: s.scoreDiff };
    // No final label, target result or revised context is consulted by either model.
    const estimate = context.predict(candidate, input);
    const baselineTeam = history.teamKey(s.offenseTeam, league, baseline.teams) || '';
    const base = baselineProbability(baseline, { ...input, team: baselineTeam });
    const row = { shownId: shown.id, game: game.key, at, targetPlayId: target, input,
      candidate: estimate, baseline: base, displayed: Number.isFinite(shown.probabilityShown) && shown.probabilityShown >= 0 && shown.probabilityShown <= 1 ? shown.probabilityShown : null,
      reasons: [], prospectiveExclusions: [], eligible: false };
    if (!Number.isFinite(at)) row.reasons.push('missing_display_time');
    if (String(s.gameId) !== String(game.meta.gameId)) row.reasons.push('saved_game_mismatch');
    if (!s.offenseTeam?.id || !(game.meta.teams || []).some(t => String(t.id) === String(s.offenseTeam.id))) row.reasons.push('unknown_saved_offense');
    if (shown.visibility !== 'visible' || shown.historicalOnArrival) row.reasons.push('not_live_visible');
    if (links.size !== 1) row.reasons.push(links.size ? 'conflicting_target_links' : 'no_explicit_target');
    if (target && !arrivals.has(target)) row.reasons.push('missing_target_arrival');
    else if (target && at >= arrivals.get(target)) row.reasons.push('target_already_arrived');
    const basis = String(shown.basisPlayId) + ':' + String(shown.basisRevision);
    if (!releases.has(basis) || releases.get(basis) > at) row.reasons.push('basis_not_released');
    if (!row.reasons.length) {
      // Selection depends on visibility/arrival only, never on later outcomes.
      const prior = selected.get(target);
      if (prior) prior.row.reasons.push('superseded_visible_input');
      selected.set(target, { row, shown });
    }
    rows.push(row);
  }
  for (const { row, shown } of selected.values()) {
    const s = shown.situation || {}, label = labels.plays[row.targetPlayId];
    if (!row.candidate || !Number.isFinite(row.baseline)) row.reasons.push('unknown_model_context');
    if (!label) row.reasons.push('missing_aligned_label');
    else {
      if (!label.eligible || ![0, 1].includes(label.passLabel)) row.reasons.push('ineligible_outcome_family');
      const differences = [];
      for (const field of ['down', 'distance', 'yardsToGoal']) if (s[field] !== label[field]) differences.push(field);
      if (String(s.offenseTeam?.id) !== String(label.offenseId)) differences.push('offense');
      if (differences.length) row.reasons.push('target_situation_mismatch');
      row.targetSituationDifferences = differences;
      row.laterContextDifferences = ['period', 'clockSeconds', 'scoreDiff'].filter(field => s[field] !== label[field]);
      row.laterReportedContext = Object.fromEntries(['period', 'clockSeconds', 'scoreDiff'].map(field => [field, label[field] ?? null]));
      row.actual = label.passLabel;
    }
    if (row.at <= frozenAt) row.prospectiveExclusions.push('before_candidate_freeze');
    if (s.season !== freeze.targetSeason || ![2, 3].includes(s.seasonType)) row.prospectiveExclusions.push('season_not_saved_or_outside_target');
    if (!row.reasons.length) {
      row.eligible = true;
      row.cohort = row.prospectiveExclusions.length ? 'development' : 'prospective';
      row.brier = { baseline: (row.baseline - row.actual) ** 2, candidate: (row.candidate.probability - row.actual) ** 2 };
    }
  }
  const counts = {};
  for (const row of rows) for (const reason of row.reasons) counts[reason] = (counts[reason] || 0) + 1;
  return { schemaVersion: 1, game: game.key, league, rows,
    summary: { savedGuidance: rows.length, eligibleCounterfactuals: rows.filter(r => r.eligible).length,
      excludedRecords: rows.filter(r => !r.eligible).length,
      displayedProbabilityLinks: rows.filter(r => r.eligible && r.displayed != null).length,
      prospective: rows.filter(r => r.eligible && r.cohort === 'prospective').length, exclusions: counts },
    limitations: ['Offline model outputs were not necessarily displayed to the viewer.',
      'Final labels are source-aligned, not independent video judgments.',
      'Later context differences do not repair the original input and do not by themselves prove an input error.',
      'Visible saved moments are selective and do not represent all plays or viewers.'] };
}
module.exports = { replay, baselineProbability };

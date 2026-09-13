/* Descriptive previous-season outcomes. No network, reports or forecasts. */
(function (root) {
  'use strict';
  function context(s) {
    if (!s || !Number.isInteger(s.down) || s.down < 1 || s.down > 4 ||
        !Number.isInteger(s.distance) || s.distance < 1 ||
        !Number.isInteger(s.yardsToGoal) || s.yardsToGoal < s.distance || s.yardsToGoal > 99 ||
        !Number.isInteger(s.period) || s.period < 1 || s.period > 4 ||
        !Number.isInteger(s.clockSeconds) || s.clockSeconds < 0 || s.clockSeconds > 900 ||
        !Number.isFinite(s.scoreDiff)) return null;
    return ['d' + s.down, s.distance <= 3 ? 'short' : s.distance <= 6 ? 'medium' : 'long',
      s.distance === s.yardsToGoal ? 'goal' : s.yardsToGoal <= 20 ? 'red' : 'open',
      s.scoreDiff >= 9 ? 'ahead' : s.scoreDiff <= -9 ? 'behind' : 'close',
      s.period === 4 && s.clockSeconds <= 300 ? 'late' : s.period === 2 && s.clockSeconds <= 120 ? 'half' : 'ordinary'].join('|');
  }
  function normalize(name) {
    return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/&/g, ' and ').replace(/\bst\.?\b/g, 'state').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function teamKey(team, league, teams) {
    if (!team || !teams) return null;
    if (league === 'nfl') {
      var abbr = String(team.abbreviation || '').toUpperCase();
      var key = { LAR: 'LA', WSH: 'WAS', JAC: 'JAX' }[abbr] || abbr;
      return Object.hasOwn(teams, key) ? key : null;
    }
    var names = [team.location, team.shortDisplayName, team.displayName, team.name].filter(Boolean).map(normalize);
    return Object.keys(teams).find(function (key) { return names.includes(normalize(key)); }) || null;
  }
  function count(n) { return Number.isInteger(n) && n >= 0; }
  function usable(cell) {
    return cell && count(cell.n) && cell.n >= 20 && count(cell.games) && cell.games >= 5 &&
      count(cell.conversionKnown) && cell.conversionKnown <= cell.n && count(cell.conversions) && cell.conversions <= cell.conversionKnown &&
      ['run', 'pass'].every(function (action) { var a = cell[action]; return a && count(a.n) && a.n <= cell.n && count(a.yardsKnown) && a.yardsKnown <= a.n; });
  }
  function metric(cell, action) {
    var a = cell && cell[action];
    return a && count(a.n) && a.n <= cell.n && count(a.yardsKnown) && a.yardsKnown >= 15 &&
      a.yardsKnown <= a.n && a.yardsKnown / a.n >= .9 &&
      ['twoOrLess', 'fivePlus', 'tenPlus'].every(function (k) { return count(a[k]) && a[k] <= a.yardsKnown; }) ? a : null;
  }
  function conversion(cell) { return usable(cell) && cell.conversionKnown >= 20 && cell.conversionKnown / cell.n >= .9; }
  function lookup(data, s, league) {
    var key = context(s);
    // Season is supplied by the selected game, never inferred from today's date.
    if (!key || !data || data.schemaVersion !== 1 || data.version !== 'history-1' || data.league !== league ||
        !Number.isInteger(data.season) || s.season !== data.season + 1 || ![2, 3].includes(s.seasonType) ||
        !data.id || !data.offense || !data.defense || !s.offenseTeam || !s.offenseTeam.id || !s.defenseTeam || !s.defenseTeam.id) return null;
    var offense = teamKey(s.offenseTeam, league, data.offense), defense = teamKey(s.defenseTeam, league, data.defense);
    var rows = [];
    [['offense', offense], ['defense', defense]].forEach(function (pair) {
      var side = pair[0], team = pair[1], cell = team && data[side][team][key];
      if (usable(cell)) rows.push({ side: side, team: team, cell: cell });
    });
    if (!rows.length) return null;
    return { gameId: String(s.gameId), offenseId: String(s.offenseTeam.id), defenseId: String(s.defenseTeam.id), key: key, season: data.season, datasetId: data.id,
      source: data.source, note: data.note, rows: rows };
  }
  function describe(key) {
    var p = key.split('|');
    return ({ d1: 'First', d2: 'Second', d3: 'Third', d4: 'Fourth' }[p[0]]) + ' down · ' +
      ({ short: '1–3', medium: '4–6', long: '7+' }[p[1]]) + ' yards to gain · ' +
      ({ goal: 'goal to go', red: 'inside the 20', open: 'outside the 20' }[p[2]]) + ' · ' +
      ({ ahead: 'offense ahead by 9+', behind: 'offense behind by 9+', close: 'score within 8 points' }[p[3]]) + ' · ' +
      ({ late: 'last 5 minutes of regulation', half: 'last 2 minutes of the first half', ordinary: 'outside those late-clock windows' }[p[4]]);
  }
  function reference(h, row) { return { datasetId: h.datasetId, season: h.season, side: row.side, team: row.team, key: h.key }; }
  function read(s, h) {
    if (!h || h.gameId !== String(s.gameId) || h.key !== context(s) || s.season !== h.season + 1 ||
        h.offenseId !== String(s.offenseTeam && s.offenseTeam.id) || h.defenseId !== String(s.defenseTeam && s.defenseTeam.id)) return null;
    var off = h.rows.find(function (r) { return r.side === 'offense'; });
    var def = h.rows.find(function (r) { return r.side === 'defense'; });
    var result, refs;
    if (s.down === 3 && off && def && conversion(off.cell) && conversion(def.cell)) {
      result = { id: 'history_third_down', headline: 'How these third downs went last season.',
        detail: off.team + ' converted ' + off.cell.conversions + ' of ' + off.cell.conversionKnown + ' similar third downs. Offenses facing ' + def.team +
          ' converted ' + def.cell.conversions + ' of ' + def.cell.conversionKnown + '. These counts use plays with a clear result.',
        watch: 'On a pass, watch the defender nearest the short route. Does he close before the catch, or does another receiver hold him deeper? That space can decide whether an underneath throw has a chance to convert.', lessonId: 'first_down_line' };
      refs = [reference(h, off), reference(h, def)];
    } else if (s.down <= 2 && s.distance >= 7 && off) {
      var runs = metric(off.cell, 'run');
      if (!runs || runs.twoOrLess / runs.yardsKnown < .35) return null;
      result = { id: 'history_short_runs', headline: 'Short runs left this offense with ground to make up.',
        detail: 'In ' + h.season + ', ' + runs.twoOrLess + ' of ' + runs.yardsKnown + ' ' + off.team + ' runs with clear yardage gained two yards or less in similar situations.',
        watch: 'On a run, watch where the blocking first breaks down: does a defender cross the line untouched, shed a block, or meet the runner farther upfield? That helps distinguish a blocked path from a run that reaches the next layer of defenders.' };
      refs = [reference(h, off)];
    }
    if (!result) return null;
    return Object.assign(result, { priority: 70, key: result.id + ':' + h.datasetId + ':' + h.key + ':' + refs.map(function (r) { return r.team; }).join(':'),
      historyRefs: refs, source: h.source.label + ' · ' + h.season + ' season' });
  }
  var api = { context: context, teamKey: teamKey, lookup: lookup, describe: describe, metric: metric, conversion: conversion, reference: reference, read: read };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FootballHistory = api;
})(typeof window !== 'undefined' ? window : null);

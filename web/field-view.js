/* TV orientation is a viewer preference over released pre-snap context. */
(function (root) {
  'use strict';
  function scope(period) { return period <= 4 ? 'half' + Math.ceil(period / 2) : 'period' + period; }
  function identity(sit, league) {
    var offense = sit.offenseTeam && sit.offenseTeam.id, defense = sit.defenseTeam && sit.defenseTeam.id;
    if (!['nfl', 'cfb'].includes(league) || !sit.gameId || !offense || !defense || String(offense) === String(defense) ||
        !Number.isInteger(sit.period) || sit.period < 1) return null;
    return { key: 'ff_field_view_' + league + ':' + sit.gameId, teams: [String(offense), String(defense)].sort(),
      offense: String(offense), period: sit.period, scope: scope(sit.period) };
  }
  function geometry(sit, right) {
    if (!Number.isFinite(sit.yardsToGoal) || sit.yardsToGoal < 0 || sit.yardsToGoal > 100 ||
        !Number.isFinite(sit.distance) || sit.distance < 0) return null;
    var progress = 100 - sit.yardsToGoal, target = Math.min(100, progress + sit.distance);
    return { ball: 30 + (right ? progress : 100 - progress) * 44 / 10,
      target: 30 + (right ? target : 100 - target) * 44 / 10, goal: sit.distance >= sit.yardsToGoal };
  }
  function create(options) {
    options = options || {};
    var memory = {}, storage = options.storage;
    function read(id) {
      var record = memory[id.key];
      try {
        var raw = storage.getItem(id.key);
        if (raw) {
          var saved = JSON.parse(raw);
          if (saved.version === 1 && JSON.stringify(saved.teams) === JSON.stringify(id.teams) &&
              saved.settings && typeof saved.settings === 'object' && !Array.isArray(saved.settings)) record = saved;
        }
      } catch (_) {}
      if (!record || JSON.stringify(record.teams) !== JSON.stringify(id.teams)) record = { version: 1, teams: id.teams, settings: {} };
      memory[id.key] = record;
      return record;
    }
    function view(sit, league) {
      var id = identity(sit, league), right = true, matched = false;
      if (id) {
        var anchor = read(id).settings[id.scope];
        if (anchor && Number.isInteger(anchor.period) && anchor.period >= 1 && scope(anchor.period) === id.scope &&
            id.teams.includes(anchor.offense) && typeof anchor.right === 'boolean') {
          matched = true; right = anchor.right;
          // NCAA extra periods use one end for both teams' possession series.
          if (!(league === 'cfb' && id.period > 4) && id.offense !== anchor.offense) right = !right;
          // The second half and each extra period require their own TV match.
          if (id.period <= 4 && id.period !== anchor.period) right = !right;
        }
      }
      return { right: right, matched: matched, canMatch: !!id, geometry: geometry(sit, right),
        leftTeam: right ? sit.offenseTeam : sit.defenseTeam,
        rightTeam: right ? sit.defenseTeam : sit.offenseTeam };
    }
    function match(sit, league, right) {
      var id = identity(sit, league);
      if (!id || typeof right !== 'boolean') return false;
      var record = read(id);
      record.settings[id.scope] = { period: id.period, offense: id.offense, right: right };
      try { storage.setItem(id.key, JSON.stringify(record)); } catch (_) { storage = null; }
      return true;
    }
    return { view: view, match: match };
  }
  var api = { create: create, geometry: geometry };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FootballField = api;
})(typeof window !== 'undefined' ? window : globalThis);

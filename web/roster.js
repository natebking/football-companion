(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FootballRoster = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function string(value) { return typeof value === 'string' ? value.trim() : ''; }
  function jersey(value) {
    var text = typeof value === 'number' ? String(value) : string(value);
    return /^\d{1,2}$/.test(text) ? String(Number(text)) : null;
  }
  function normalize(value) {
    return string(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  }
  function identity(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = typeof raw.id === 'number' ? String(raw.id) : string(raw.id);
    if (!id || (!string(raw.fullName) && !string(raw.displayName))) return null;
    var out = { id: id };
    ['displayName', 'fullName', 'shortName', 'firstName', 'lastName'].forEach(function (key) {
      if (string(raw[key])) out[key] = string(raw[key]);
    });
    out.jersey = jersey(raw.jersey);
    return out;
  }
  function unique(athletes) {
    var byId = new Map();
    athletes.forEach(function (raw) {
      var athlete = identity(raw);
      if (!athlete) return;
      if (byId.has(athlete.id) && JSON.stringify(byId.get(athlete.id)) !== JSON.stringify(athlete)) {
        throw new Error('Conflicting roster identity for athlete ' + athlete.id);
      }
      byId.set(athlete.id, athlete);
    });
    return Array.from(byId.values());
  }
  function fromResponse(data, options) {
    options = options || {};
    if (!['cfb', 'nfl'].includes(options.league) || !/^\d+$/.test(options.teamId || '') ||
        typeof options.teamId !== 'string' || !Number.isInteger(options.season)) {
      throw new Error('Invalid roster request');
    }
    if (!data || !data.team || String(data.team.id) !== options.teamId ||
        !data.season || data.season.year !== options.season) {
      throw new Error('Roster team or season does not match request');
    }
    var raw = [];
    if (Array.isArray(data.athletes)) data.athletes.forEach(function (group) {
      if (group && Array.isArray(group.items)) raw = raw.concat(group.items);
    });
    var athletes = unique(raw);
    if (!athletes.length) throw new Error('Roster unavailable: no athlete identities');
    return {
      schemaVersion: 1, league: options.league, teamId: options.teamId, season: options.season,
      retrievedAt: string(options.retrievedAt) || new Date().toISOString(),
      sourceUrl: 'https://site.api.espn.com/apis/site/v2/sports/football/' +
        (options.league === 'nfl' ? 'nfl' : 'college-football') + '/teams/' + options.teamId +
        '/roster?season=' + options.season,
      athletes: athletes
    };
  }
  function resolve(record, reportedName) {
    if (!record || record.schemaVersion !== 1 || !Array.isArray(record.athletes) ||
        typeof reportedName !== 'string') return null;
    var report = reportedName.trim();
    var number = /^#(\d{1,2})\s+(.+)$/.exec(report);
    var explicit = number ? jersey(number[1]) : null;
    var name = number ? number[2] : report;
    var key = normalize(name);
    if (!key) return null;
    var athletes;
    try { athletes = unique(record.athletes); } catch (_) { return null; }
    var candidates = athletes.filter(function (athlete) {
      return ['fullName', 'displayName', 'shortName'].some(function (field) {
        return athlete[field] && normalize(athlete[field]) === key;
      });
    });
    if (number) candidates = candidates.filter(function (athlete) {
      return athlete.jersey === null || athlete.jersey === explicit;
    });
    if (candidates.length !== 1) return null;
    var athlete = candidates[0];
    var chosenNumber = number ? number[1] : athlete.jersey;
    var fullName = athlete.fullName || athlete.displayName;
    return {
      athleteId: athlete.id, label: (chosenNumber !== null ? '#' + chosenNumber + ' ' : '') + fullName,
      reportedName: reportedName, fullName: fullName,
      jersey: number ? explicit : athlete.jersey,
      numberSource: number ? 'report' : athlete.jersey !== null ? 'roster' : null
    };
  }
  function displayName(record, name) { var result = resolve(record, name); return result ? result.label : name; }
  return { fromResponse: fromResponse, resolve: resolve, displayName: displayName };
});

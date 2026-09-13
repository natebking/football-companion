(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./roster.js'));
  else root.FootballRosterClient = factory(root.FootballRoster);
})(typeof window !== 'undefined' ? window : globalThis, function (roster) {
  'use strict';
  var CACHE_KEY = 'fc_rosters_v1';
  var TTL = 24 * 60 * 60 * 1000;
  var BACKOFF = 5 * 60 * 1000;
  function key(scope) { return scope.league + ':' + scope.season + ':' + scope.teamId; }
  function create(options) {
    options = options || {};
    var now = options.now || Date.now;
    var records = new Map();
    var pending = new Map();
    var failures = new Map();
    var active = new Set();
    var version = 0;
    function fresh(record) {
      var age = now() - Date.parse(record.retrievedAt);
      return Number.isFinite(age) && age >= 0 && age < TTL;
    }
    function sanitize(record) {
      if (!record || record.schemaVersion !== 1 || !Array.isArray(record.athletes) || !fresh(record)) return null;
      try {
        var clean = roster.fromResponse({ team: { id: record.teamId }, season: { year: record.season },
          athletes: [{ items: record.athletes }] }, record);
        return clean.sourceUrl === record.sourceUrl ? clean : null;
      } catch (_) { return null; }
    }
    function trim() {
      records.forEach(function (record, id) { if (!fresh(record)) records.delete(id); });
      var ordered = Array.from(records.entries()).sort(function (a, b) {
        return Date.parse(b[1].retrievedAt) - Date.parse(a[1].retrievedAt);
      });
      ordered.slice(24).forEach(function (entry) { records.delete(entry[0]); });
    }
    function save() {
      trim();
      try { if (options.storage) options.storage.setItem(CACHE_KEY, JSON.stringify(Array.from(records.values()))); } catch (_) {}
    }
    try {
      var cached = options.storage && JSON.parse(options.storage.getItem(CACHE_KEY));
      if (Array.isArray(cached)) {
        // Duplicate scopes in persisted data are not allowed to overwrite one another.
        var seen = new Set();
        var conflicts = new Set();
        cached.forEach(function (record) {
          var clean = sanitize(record);
          if (!clean) return;
          var id = key(clean);
          if (seen.has(id)) { records.delete(id); conflicts.add(id); }
          else if (!conflicts.has(id)) records.set(id, clean);
          seen.add(id);
        });
        trim();
      }
    } catch (_) {}
    function attempt(scope) {
      var id = key(scope);
      var cached = records.get(id);
      if (cached && fresh(cached)) return Promise.resolve();
      if (pending.has(id)) return pending.get(id);
      if (failures.has(id) && now() - failures.get(id) < BACKOFF) return Promise.resolve();
      var controller = new AbortController();
      var timer;
      var timeout = new Promise(function (_, reject) {
        timer = setTimeout(function () { controller.abort(); reject(new Error('Roster timeout')); }, 10000);
      });
      var url = 'https://site.api.espn.com/apis/site/v2/sports/football/' +
        (scope.league === 'nfl' ? 'nfl' : 'college-football') + '/teams/' + scope.teamId + '/roster?season=' + scope.season;
      var request = Promise.resolve().then(function () {
        return options.fetchJSON(url, { signal: controller.signal });
      });
      var job = Promise.race([request, timeout]).then(function (data) {
        var record = roster.fromResponse(data, Object.assign({}, scope, { retrievedAt: new Date(now()).toISOString() }));
        records.set(id, record);
        failures.delete(id);
        save();
        if (active.has(id)) {
          version += 1;
          try { if (options.onChange) options.onChange(); } catch (_) {}
        }
      }).catch(function () { failures.set(id, now()); }).finally(function () {
        clearTimeout(timer);
        pending.delete(id);
      });
      pending.set(id, job);
      return job;
    }
    function setContext(context) {
      failures.forEach(function (failedAt, id) {
        if (now() - failedAt >= BACKOFF) failures.delete(id);
      });
      var scopes = [];
      if (context && ['nfl', 'cfb'].includes(context.league) && Number.isInteger(context.season) && Array.isArray(context.teamIds)) {
        Array.from(new Set(context.teamIds)).forEach(function (teamId) {
          if (typeof teamId === 'string' && /^\d+$/.test(teamId)) scopes.push({ league: context.league, season: context.season, teamId: teamId });
        });
      }
      var next = new Set(scopes.map(key));
      if (next.size !== active.size || Array.from(next).some(function (id) { return !active.has(id); })) version += 1;
      active = next;
      return Promise.all(scopes.map(attempt));
    }
    function clearContext() { if (active.size) version += 1; active = new Set(); }
    function expireVisible() {
      var expired = false;
      active.forEach(function (id) {
        var record = records.get(id);
        if (record && !fresh(record)) { records.delete(id); expired = true; }
      });
      if (expired) version += 1;
    }
    function resolve(teamId, name) {
      expireVisible();
      var match = null;
      active.forEach(function (id) {
        var record = records.get(id);
        if (!record || record.teamId !== teamId || !fresh(record)) return;
        var identity = roster.resolve(record, name);
        if (identity) match = Object.assign({}, identity, { roster: {
          league: record.league, teamId: record.teamId, season: record.season,
          sourceUrl: record.sourceUrl, retrievedAt: record.retrievedAt
        } });
      });
      return match;
    }
    return { setContext: setContext, clearContext: clearContext, resolve: resolve, revision: function () { expireVisible(); return version; } };
  }
  return { create: create };
});

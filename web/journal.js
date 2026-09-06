/* Local, per-game evidence. Source revisions and shown wording are append-only;
 * later reports can be compared with them, never substituted for them. */
(function (root) {
  'use strict';
  var PREFIX = 'ff_journal_v1_', INDEX = PREFIX + 'index';
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stable(value[key]);
    }).join(',') + '}';
    return JSON.stringify(value);
  }
  function failure(code, message) { var error = new Error(message); error.code = code; return error; }
  function gameKey(meta) {
    if (!meta || !/^(cfb|nfl)$/.test(meta.league) || !/^\d+$/.test(String(meta.gameId || ''))) throw failure('invalid_game', 'A league and ESPN game ID are required.');
    return meta.league + ':' + meta.gameId;
  }
  function create(options) {
    options = options || {};
    var storage = options.storage, now = options.now || Date.now;
    var maxGames = options.maxGames || 10, maxGameBytes = options.maxGameBytes || 2000000;
    var state = { ok: true };
    function fail(error) {
      state = { ok: false, code: error.code || (/quota/i.test(error.name || '') ? 'quota' : 'storage'),
        error: error.code ? error.message : 'The browser could not save this journal entry. Download or remove an older journal to free space.' };
      return clone(state);
    }
    function read(key) {
      if (!storage || !storage.getItem || !storage.setItem || !storage.removeItem) throw failure('storage', 'Browser storage is unavailable.');
      var text = storage.getItem(key);
      if (!text) return null;
      try { return JSON.parse(text); } catch (_) { throw failure('corrupt', 'A saved journal could not be read. It has not been overwritten.'); }
    }
    function index() {
      var keys = read(INDEX) || [];
      if (!Array.isArray(keys) || keys.some(function (key) { return typeof key !== 'string'; })) throw failure('corrupt', 'The journal list could not be read.');
      return keys;
    }
    function load(key) {
      var game = read(PREFIX + key);
      if (game && (game.schemaVersion !== 1 || game.key !== key || !Array.isArray(game.sources) || !Array.isArray(game.shown) || !Array.isArray(game.releases) || !Array.isArray(game.observations))) {
        throw failure('corrupt', 'This saved journal has an unsupported format.');
      }
      return game;
    }
    function save(game) {
      var text = JSON.stringify(game);
      // UTF-16 accounting is conservative for localStorage's implementation-
      // dependent quota. No earlier entries are removed to make room.
      if (text.length * 2 > maxGameBytes) throw failure('game_limit', 'This game journal reached its size limit. Download it to keep a copy; earlier entries are still saved.');
      storage.setItem(PREFIX + game.key, text);
    }
    function mutate(key, edit) {
      try {
        var game = load(key);
        if (!game) throw failure('missing_game', 'Start this game journal before recording entries.');
        var result = edit(game) || {};
        if (result.changed !== false) { game.updatedAt = now(); save(game); }
        delete result.changed;
        return Object.assign({ ok: true }, result);
      } catch (error) { return fail(error); }
    }
    function beginGame(meta) {
      try {
        var key = gameKey(meta), clean = clone(meta), existing = load(key);
        clean.gameId = String(clean.gameId);
        if (existing) {
          if (stable(existing.meta) !== stable(clean)) { existing.meta = clean; existing.updatedAt = now(); save(existing); }
          return { ok: true, key: key };
        }
        var keys = index();
        if (keys.length >= maxGames) throw failure('game_count', 'The journal holds ' + maxGames + ' games. Download or remove an older game before starting another.');
        var game = { schemaVersion: 1, key: key, meta: clean, createdAt: now(), updatedAt: now(), nextId: 1,
          sources: [], releases: [], shown: [], observations: [] };
        save(game);
        try { storage.setItem(INDEX, JSON.stringify(keys.concat(key))); }
        catch (error) { storage.removeItem(PREFIX + key); throw error; }
        return { ok: true, key: key };
      } catch (error) { return fail(error); }
    }
    function recordSources(key, entries) {
      return mutate(key, function (game) {
        var changed = false, results = [], byPlay = new Map();
        game.sources.forEach(function (revision) {
          if (!byPlay.has(revision.playId)) byPlay.set(revision.playId, []);
          byPlay.get(revision.playId).push(revision);
        });
        (entries || []).forEach(function (entry) {
          if (!entry || !entry.report || entry.report.id == null || entry.report.id === '') throw failure('invalid_report', 'A source report needs its play ID.');
          var report = clone(entry.report), playId = String(report.id), source = entry.source || 'espn';
          var revisions = byPlay.get(playId) || [], text = stable(report);
          var sameSource = revisions.filter(function (item) { return item.source === source; });
          var latest = sameSource[sameSource.length - 1];
          // A -> B -> A is a third revision, not a rewrite of the first A.
          // Release calls can arrive after a newer version was observed.
          var matching = sameSource.filter(function (item) { return stable(item.report) === text; });
          var revision = entry.releasedAt != null ? matching.find(function (item) { return item.observedAt === entry.observedAt; }) || matching[matching.length - 1] :
            latest && stable(latest.report) === text ? latest : null;
          var deduped = !!revision;
          if (!revision) {
            revision = { playId: playId, revisionId: playId + ':' + (revisions.length + 1), source: source,
              observedAt: entry.observedAt === undefined ? now() : entry.observedAt, report: report };
            if (entry.timingIssue) revision.timingIssue = entry.timingIssue;
            revisions.push(revision); byPlay.set(playId, revisions); game.sources.push(revision); changed = true;
          }
          if (entry.releasedAt != null) {
            if (Number.isFinite(revision.observedAt) && Number.isFinite(entry.releasedAt) && entry.releasedAt < revision.observedAt) throw failure('invalid_time', 'A report cannot be released before it arrived.');
            var already = game.releases.some(function (release) { return release.revisionId === revision.revisionId && release.at === entry.releasedAt; });
            if (!already) { game.releases.push({ playId: playId, revisionId: revision.revisionId, at: entry.releasedAt }); changed = true; }
          }
          results.push({ revisionId: revision.revisionId, deduped: deduped });
        });
        return { changed: changed, results: results };
      });
    }
    function recordSource(key, entry) {
      var result = recordSources(key, [entry]);
      return result.ok ? Object.assign({ ok: true }, result.results[0]) : result;
    }
    function append(key, field, entry) {
      return mutate(key, function (game) {
        var value = clone(entry || {});
        if (field === 'observations' && value.shownId && !game.shown.some(function (shown) { return shown.id === value.shownId; })) throw failure('unknown_prompt', 'This observation does not match a saved prompt.');
        if (field === 'shown' && value.kind === 'play' && value.report) {
          var matching = game.sources.filter(function (revision) { return revision.playId === String(value.playId) && stable(revision.report) === stable(value.report); });
          if (matching.length) value.revisionId = matching[matching.length - 1].revisionId;
          delete value.report;
        }
        value.id = field + ':' + game.nextId++;
        if (value.at === undefined) value.at = now();
        game[field].push(value);
        return { id: value.id };
      });
    }
    function loadGame(key) { try { return load(key); } catch (error) { fail(error); return null; } }
    function listGames() {
      try { return index().map(load).filter(Boolean).map(function (game) {
        return { key: game.key, meta: game.meta, createdAt: game.createdAt, updatedAt: game.updatedAt,
          sourceCount: game.sources.length, shownCount: game.shown.length, observationCount: game.observations.length };
      }).sort(function (a, b) { return b.updatedAt - a.updatedAt; }); }
      catch (error) { fail(error); return []; }
    }
    function exportGame(key) { var game = loadGame(key); return game ? JSON.stringify(game, null, 2) : null; }
    function removeGame(key) {
      try {
        var keys = index();
        storage.setItem(INDEX, JSON.stringify(keys.filter(function (item) { return item !== key; })));
        storage.removeItem(PREFIX + key); state = { ok: true }; return { ok: true };
      } catch (error) { return fail(error); }
    }
    return { beginGame: beginGame, recordSources: recordSources, recordSource: recordSource,
      recordShown: function (key, entry) { return append(key, 'shown', entry); },
      recordObservation: function (key, entry) { return append(key, 'observations', entry); },
      listGames: listGames, loadGame: loadGame, exportGame: exportGame, removeGame: removeGame,
      status: function () { return clone(state); } };
  }

  function compare(game, review) {
    if (!game || !review || review.status !== 'final' || game.key !== review.key) return { available: false, reason: 'A finished review for this exact game is required.', plays: [], predictions: [] };
    var facts = typeof module !== 'undefined' && module.exports ? require('./play-facts.js') : root.FootballPlay;
    var abbr = {}, final = new Map(), sources = new Map(), comparisons = [], firstReceipt = new Map();
    (review.teams || []).forEach(function (team) { abbr[String(team.id)] = team.abbreviation; });
    (review.plays || []).forEach(function (play) { final.set(String(play.id), play); });
    function time(value) { return typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN; }
    (game.sources || []).forEach(function (revision) {
      sources.set(revision.revisionId, revision);
      var at = time(revision.observedAt), old = firstReceipt.get(revision.playId);
      if (Number.isFinite(at) && (old === undefined || at < old)) firstReceipt.set(revision.playId, at);
    });
    function visible(shown) { return !shown.historicalOnArrival && (!shown.visibility || shown.visibility === 'visible'); }
    function finalFacts(play) {
      var report = clone(play.report), passing = play.enrichment && play.enrichment.passing;
      if (passing && passing.yardageVerified) { report.airYards = passing.airYards; report.yardsAfterCatch = passing.yardsAfterCatch; }
      return facts.describe(report, abbr);
    }
    (game.shown || []).filter(function (shown) { return shown.kind === 'play' && visible(shown); }).forEach(function (shown) {
      var play = final.get(String(shown.playId)), before = shown.facts || null;
      if (!play || !before) { comparisons.push({ shownId: shown.id, playId: String(shown.playId), status: 'unmatched', changes: [] }); return; }
      var after = finalFacts(play), changes = [];
      ['outcome', 'gained', 'need', 'kind', 'turnover', 'summary', 'consequence', 'players', 'facts', 'movement', 'airYards', 'yardsAfterCatch'].forEach(function (field) {
        if (before[field] !== undefined && stable(before[field]) !== stable(after[field])) changes.push({ field: field, before: before[field], after: after[field],
          type: (field === 'airYards' || field === 'yardsAfterCatch') && before[field] === null && Number.isFinite(after[field]) ? 'enriched' : 'changed' });
      });
      var source = sources.get(shown.revisionId);
      var evidenceKeys = ['type', 'text', 'statYardage', 'start', 'end', 'scoringPlay', 'isPenalty', 'isTurnover', 'pointAfterAttempt', 'scoringType', 'scoreValue', 'clock', 'period'];
      function evidence(report) { var out = {}; evidenceKeys.forEach(function (key) { if (report[key] !== undefined) out[key] = report[key]; }); return out; }
      comparisons.push({ shownId: shown.id, playId: String(shown.playId), status: changes.length ? changes.every(function (change) { return change.type === 'enriched'; }) ? 'enriched' : 'changed' : 'consistent',
        changes: changes, before: before, after: after, sourceChanged: source ? stable(evidence(source.report)) !== stable(evidence(play.report)) : null });
    });
    var predictions = [], resolutions = new Map(), linkedIds = new Set();
    (game.observations || []).filter(function (entry) { return entry.kind === 'resolution' && entry.shownId; }).forEach(function (entry) { resolutions.set(entry.shownId, entry); });
    (game.shown || []).filter(function (shown) { return shown.kind === 'guidance'; }).slice().reverse().forEach(function (shown) {
      var resolution = resolutions.get(shown.id), playId = shown.targetPlayId || resolution && resolution.playId;
      var play = playId && final.get(String(playId));
      var probability = typeof shown.probabilityShown === 'number' ? shown.probabilityShown : null;
      var row = { shownId: shown.id, playId: playId ? String(playId) : null, probability: probability,
        modelProbability: shown.modelProbability, baselineProbability: shown.baselineProbability, status: 'unmatched', eligibleForEvaluation: false };
      if (play) {
        var outcome = finalFacts(play), shownAt = time(shown.shownAt === undefined ? shown.at : shown.shownAt);
        var receivedAt = firstReceipt.get(String(playId));
        row.status = 'not_linked'; row.actual = outcome.outcome; row.description = outcome.summary;
        // Historical model labels and the live quiz use different sack/scramble
        // rules. Preserve the link without inventing an evaluation score.
        if (visible(shown) && !linkedIds.has(String(playId)) && Number.isFinite(shownAt) && Number.isFinite(receivedAt) && shownAt < receivedAt &&
            !(resolution && resolution.voided) && !outcome.voidReason && !outcome.turnover && (outcome.outcome === 'pass' || outcome.outcome === 'run') &&
            typeof probability === 'number' && probability >= 0 && probability <= 1) {
          linkedIds.add(String(playId));
          row.status = 'linked';
        }
      }
      predictions.push(row);
    });
    predictions.reverse();
    var linked = predictions.filter(function (row) { return row.status === 'linked'; });
    return { available: true, plays: comparisons, predictions: predictions,
      summary: { shownPlays: comparisons.length, changed: comparisons.filter(function (row) { return row.status === 'changed'; }).length,
        enriched: comparisons.filter(function (row) { return row.status === 'enriched'; }).length,
        matched: comparisons.filter(function (row) { return row.status !== 'unmatched'; }).length, linked: linked.length },
      note: 'This review preserves the latest visible probability before each matching play first arrived. It does not score predictions: historical pass labels and live throw/run labels differ for sacks and scrambles. Source-aligned outcomes and a separate holdout are required before evaluating or changing the model.' };
  }
  var api = { create: create, compare: compare, gameKey: gameKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FootballJournal = api;
})(typeof window !== 'undefined' ? window : null);

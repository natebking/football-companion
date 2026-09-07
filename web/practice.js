/* Optional historical practice. Its evidence and results never enter LIVE or PRIME. */
(function (root) {
  'use strict';
  var KEY = 'ff_recognition_v1';
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function sourceKey(example) { return [example.league, example.gameId, example.playId].join(':'); }
  function pairFor(bank, id) {
    return (bank.practice || []).find(function (p) { return p.workedExampleId === id; }) || null;
  }
  function create(options) {
    options = options || {};
    var storage = options.storage, now = options.now || Date.now;
    function empty() { return { schemaVersion: 1, seen: {}, attempts: [] }; }
    var state = empty(), saved = true;
    function read() {
      try {
        var text = storage.getItem(KEY);
        if (text) {
          var data = JSON.parse(text);
          if (data.schemaVersion !== 1 || !data.seen || Array.isArray(data.seen) || !Array.isArray(data.attempts)) throw new Error('format');
          state = data;
        } else state = empty();
      } catch (_) { saved = false; }
    }
    read();
    function save() {
      // Keep an in-memory attempt usable when storage fails, without overwriting
      // unreadable prior records or silently removing old attempts.
      if (saved) try { storage.setItem(KEY, JSON.stringify(state)); } catch (_) { saved = false; }
    }
    function refresh() { if (saved) read(); }
    function seen(example) {
      refresh();
      var key = sourceKey(example);
      if (!state.seen[key]) { state.seen[key] = now(); save(); }
    }
    function start(bank, workedId, level) {
      refresh();
      var pair = pairFor(bank, workedId);
      if (!pair || state.attempts.length >= 200) return null;
      var target = bank.examples.find(function (e) { return e.id === pair.testExampleId; });
      var worked = bank.examples.find(function (e) { return e.id === workedId; });
      if (!target || !worked || (target.league === worked.league && target.gameId === worked.gameId)) return null;
      var key = sourceKey(target);
      var attempt = {
        id: String(now()) + '-' + Math.random().toString(36).slice(2), bankVersion: bank.version, bankHash: bank.contentHash,
        pair: copy(pair), target: { id: target.id, league: target.league, gameId: target.gameId, playId: target.playId,
          facts: copy(target.facts), sources: copy(target.sources) },
        level: level === 'basics' ? 'basics' : 'game', openedAt: now(),
        priorExampleOpened: state.seen[key] ? true : saved ? false : null,
        priorTargetQuestions: saved ? state.attempts.filter(function (a) { return sourceKey(a.target) === key; }).length : null,
        priorQuestionAttempts: saved ? state.attempts.filter(function (a) { return a.pair.id === pair.id && a.answeredAt != null; }).length : null
      };
      state.attempts.push(attempt); save();
      return copy(attempt);
    }
    function answer(id, choiceId) {
      refresh();
      var a = state.attempts.find(function (entry) { return entry.id === id; });
      if (!a || a.answeredAt != null || (choiceId !== 'unsure' && !a.pair.choices.some(function (c) { return c.id === choiceId; }))) return null;
      a.choiceId = choiceId; a.answeredAt = now();
      a.result = choiceId === 'unsure' ? 'unsure' : choiceId === a.pair.answerId ? 'supported' : 'not_supported';
      save(); return copy(a);
    }
    function clear() {
      try { storage.removeItem(KEY); } catch (_) { return false; }
      state = empty(); saved = true; return true;
    }
    return { seen: seen, start: start, answer: answer, clear: clear,
      export: function () { refresh(); return JSON.stringify(Object.assign(copy(state), {
        scope: 'Historical evidence interpretation; not video recognition or a measure of learning gains.',
        storageComplete: saved
      }), null, 2); },
      status: function () { return { saved: saved, full: state.attempts.length >= 200, attempts: state.attempts.length }; } };
  }
  var api = { create: create, pairFor: pairFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FootballPractice = api;
})(typeof window !== 'undefined' ? window : globalThis);

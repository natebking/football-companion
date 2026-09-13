'use strict';
/*
 * Fluent in Football, live page.
 *
 * THREE SCOPES. The walls between them are the design, not decoration.
 *
 *   SHELL   Config, storage, tendency tables, card library, both settings
 *           sheets and sanitized roster identities. Holds no raw ESPN reports.
 *
 *   LIVE    Everything ESPN: scoreboard, summary, plays, the recent-plays
 *           feed, the score in the header. This scope is allowed to know what
 *           happened. It reaches the rest of the app through `bus` and through
 *           nothing else.
 *
 *   PRIME   The card. Situation, tendency, watch instruction, the ask. It is a
 *           sibling scope of LIVE, so no ESPN variable is in its lexical scope
 *           at all. It receives approved records:
 *             bus 'snap'    a frozen pre-snap whitelist, built in LIVE by
 *                           copying a fixed list of keys. No play text, yards
 *                           gained, scoring flag or turnover flag exists on it.
 *             bus 'result'  observed action and grading fields for a play ALREADY
 *                           been released to his screen, used only to resolve
 *                           a call he already committed to. It arrives after
 *                           the reveal, never before it. Optional reported
 *                           players, formations and direction stay in LIVE.
 *             bus 'evidence' a whitelist of aggregates from ALREADY released
 *                           reports. Named counts and drive totals can select
 *                           a read; no raw source object crosses this boundary.
 *
 * DELAY QUEUE, in LIVE. Nothing reaches the screen, card or feed or score,
 * before observed_at + the user's broadcast delay. The delay is a setting,
 * 0 to 90 seconds, default 45, persisted, changeable mid-game. Raising it
 * re-bases everything still waiting.
 *
 * THE ASK, in PRIME. Temporal occlusion: commit before the reveal. Rationed to
 * roughly one snap in six to eight, never two in a row, higher ask_priority
 * cards get first call on the budget. Answer and latency are persisted as
 * prediction records. They never establish familiarity with a concept.
 *
 * No backend. The browser talks to ESPN directly (ESPN 403s datacenter IPs but
 * serves access-control-allow-origin: *). No LLM calls. No login, ever.
 */
(function () {

// ==================================================================== shell
var VERSION = '2026-09-13-home';
var POLL_MS = 3000;          // selected game, summary endpoint
var SB_MS = 12000;           // scoreboard, only while picking a game
var STALE_MS = 9000;         // live dot goes red after this
var TICK_MS = 250;           // delay queue pump
var FEED_MAX = 25;
var MAX_DELAY = 90;          // streaming services can trail cable by more than a minute
var ASK_LOG_MAX = 400;

var LEAGUES = {
  cfb: { path: 'college-football', label: 'College', table: 'tendency-cfb.json' },
  nfl: { path: 'nfl', label: 'NFL', table: 'tendency-nfl.json' }
};
var API = 'https://site.api.espn.com/apis/site/v2/sports/football/';

// ESPN abbreviations that differ from the nflverse keys the tables use.
var NFL_ALIAS = { LAR: 'LA', WSH: 'WAS', JAC: 'JAX' };

var LS = {
  league: 'fc_league', game: 'fc_game_',
  ledger: 'fc_ledger', asks: 'fc_asks', delay: 'fc_delay', diag: 'fc_diag', shortHints: 'fc_short_hints', teachingLevel: 'fc_teaching_level', questions: 'fc_questions'
};
var DIAG_MAX = 500;

var $ = function (id) { return document.getElementById(id); };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function jget(url, signal) {
  return fetch(url, { cache: 'no-store', signal: signal }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

function makeBus() {
  var subs = {};
  return {
    on: function (t, fn) { (subs[t] || (subs[t] = [])).push(fn); },
    emit: function (t, p) {
      var a = subs[t] || [];
      for (var i = 0; i < a.length; i++) a[i](p);
    }
  };
}
var bus = makeBus();

// ---------------------------------------------------------------- settings
var replayParam = new URLSearchParams(window.location.search).get('replay');
var replayMatch = /^(cfb|nfl):([0-9]+)$/.exec(replayParam || '');
var replayMode = replayParam !== null;
var league = replayMatch ? replayMatch[1] : lsGet(LS.league) === 'nfl' ? 'nfl' : 'cfb';
var shortHints = lsGet(LS.shortHints) === '1';
var teachingLevel = lsGet(LS.teachingLevel) === 'basics' ? 'basics' : 'game';
var predictionQuestions = lsGet(LS.questions) === '1';
var savedDelay = (function () {
  var n = parseInt(lsGet(LS.delay), 10);
  return (isFinite(n) && n >= 0 && n <= MAX_DELAY) ? n : null;
})();
var delayConfigured = savedDelay !== null;
var delaySec = delayConfigured ? savedDelay : 45;
var HISTORY = null; // Descriptive preceding-season profiles.
var TEND = null;    // tendency table for the current league
var CARDS = null;   // cards.json
var artifacts = { version: VERSION, build: null };
// Read access stays with the review panel. PRIME receives only a write function.
var journalStorage;
try { journalStorage = window.localStorage; } catch (e) { journalStorage = {
  getItem: function () { return null; }, setItem: function () { throw new Error('Browser storage unavailable'); }, removeItem: function () {}
}; }
var journal = window.FootballJournal.create({ storage: journalStorage });
// Only identity fields enter this cache. Roster membership never selects a cue.
var rosters = window.FootballRosterClient.create({
  fetchJSON: function (url, options) { return jget(url, options.signal); }, storage: journalStorage,
  onChange: function () { bus.emit('roster'); }
});
var journalContext = { key: null, basisPlayId: null, basisRevision: null };
function journalResult(result) {
  if (result && !result.ok) $('journalStatus').textContent = 'Journal paused. Open it to check storage.';
  return result;
}
function journalGame(meta) {
  if (replayMode) return null;
  var result = journalResult(journal.beginGame(meta));
  journalContext.key = meta.league + ':' + meta.gameId;
  return result;
}
function journalSources(entries) {
  if (replayMode) return null;
  if (!journalContext.key || !entries.length) return;
  return journalResult(journal.recordSources(journalContext.key, entries));
}
function journalShown(entry) {
  if (replayMode) return null;
  if (!journalContext.key) return null;
  return journalResult(journal.recordShown(journalContext.key, Object.assign({
    shownAt: Date.now(), basisPlayId: journalContext.basisPlayId, basisRevision: journalContext.basisRevision,
    delaySeconds: delaySec, artifacts: { version: VERSION, buildId: artifacts.build && artifacts.build.id,
      table: TEND && { generated: TEND.generated, seasons: TEND.seasons } },
    visibility: document.visibilityState !== 'visible' ? 'background' : document.querySelector('.sheet.on') ? 'covered' : 'visible'
  }, entry)));
}
function journalObservation(entry, key) {
  if (replayMode) return null;
  key = key || journalContext.key;
  if (key) return journalResult(journal.recordObservation(key, entry));
}
window.FootballReview.init({ journal: journal, current: function () { return Object.assign({}, journalContext); } });
window.addEventListener('football-observation', function (event) {
  var entry = event.detail;
  if (entry && entry.isLiveContext && entry.journalKey) journalObservation(Object.assign({ kind: 'learning' }, entry), entry.journalKey);
});

function delayMs() { return replayMode ? 0 : delaySec * 1000; }
function seasonsLabel() {
  var s = (TEND && TEND.seasons) || [];
  if (!s.length) return '';
  return s.length === 1 ? String(s[0]) : s[0] + '–' + s[s.length - 1];
}
function showErr(m) {
  var el = $('err');
  el.className = m ? 'on' : '';
  el.textContent = m || '';
}

// ---------------------------------------------------------------- ledger
// Seeing a term and correctly guessing an outcome are different observations.
// The ledger counts exposure only. Definitions shorten only at the user's request.
var ledger = { concepts: {} };
function loadLedger() {
  try {
    var d = JSON.parse(lsGet(LS.ledger) || 'null');
    if (d && d.concepts) ledger = d;
  } catch (e) { ledger = { concepts: {} }; }
}
function saveLedger() { lsSet(LS.ledger, JSON.stringify(ledger)); }
function bumpExposure(list) {
  if (replayMode) return;
  if (!list || !list.length) return;
  var now = new Date().toISOString();
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    ledger.concepts[c] = { exposures: ((ledger.concepts[c] || {}).exposures || 0) + 1, last_seen: now };
  }
  saveLedger();
}

// ---------------------------------------------------------------- ask log
// Every ask, answer and latency, forever, in the browser. Nothing leaves it.
var askLog = [];
function loadAsks() {
  try {
    var d = JSON.parse(lsGet(LS.asks) || 'null');
    if (d && d.length) askLog = d;
  } catch (e) { askLog = []; }
}
function logAsk(row) {
  if (replayMode) return;
  askLog.push(row);
  if (askLog.length > ASK_LOG_MAX) askLog = askLog.slice(-ASK_LOG_MAX);
  lsSet(LS.asks, JSON.stringify(askLog));
}

function invalidateCalls(game, playId) {
  if (replayMode) return;
  var changed = false;
  askLog.forEach(function (row) {
    if (row.lg === league && row.game === game && row.play_id === playId && !row.voided) {
      row.correct = null; row.voided = true; row.reason = 'feed_correction'; changed = true;
    }
  });
  if (changed) lsSet(LS.asks, JSON.stringify(askLog));
}

// ---------------------------------------------------------------- diagnostics
// A ring of the last DIAG_MAX events (polls, snaps, results, cards, errors),
// kept in the browser so a live test can be debriefed afterwards. Nothing in it
// leaves the phone unless he taps "Copy diagnostics". It records what the app
// did and when, including source IDs, revisions, and timing. It does not
// persist full ESPN responses or supply diagnostic fields to card selection.
var diagRing = [];
var diagDirty = false;
function loadDiag() {
  try {
    var d = JSON.parse(lsGet(LS.diag) || 'null');
    if (d && d.length) diagRing = d.slice(-DIAG_MAX);
  } catch (e) { diagRing = []; }
}
function diag(kind, data) {
  if (replayMode) return;
  // Coalesce consecutive unchanged polls, retaining their cadence and time span.
  // Arrival timestamps alone are not a change in the feed. Resumptions, errors,
  // revisions, queue changes and clock changes still get their own records.
  var previous = diagRing[diagRing.length - 1];
  if (kind === 'poll' && previous && previous.k === 'poll' && pollSignature(previous.d) === pollSignature(data)) {
    previous.polls = (previous.polls || 1) + 1;
    previous.last_t = Date.now();
    previous.last_response_gap_ms = data.response_gap_ms;
    previous.max_response_gap_ms = Math.max(previous.max_response_gap_ms || previous.d.response_gap_ms || 0, data.response_gap_ms || 0);
    diagDirty = true;
    return;
  }
  var row = { t: Date.now(), k: kind };
  if (data !== undefined) row.d = data;
  diagRing.push(row);
  if (diagRing.length > DIAG_MAX) diagRing = diagRing.slice(-DIAG_MAX);
  diagDirty = true;
}
function pollSignature(data) {
  var state = {};
  Object.keys(data || {}).sort().forEach(function (key) {
    if (key !== 'received_at' && key !== 'response_gap_ms') state[key] = data[key];
  });
  return JSON.stringify(state);
}
function flushDiag() {
  if (!diagDirty) return;
  diagDirty = false;
  lsSet(LS.diag, JSON.stringify(diagRing));
}
setInterval(flushDiag, 30000);
window.addEventListener('pagehide', flushDiag);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') flushDiag();
});
function diagPayload(extra) {
  var out = {
    version: VERSION, at: new Date().toISOString(), ua: navigator.userAgent,
    league: league, delay_sec: delaySec,
    tables: TEND ? { generated: TEND.generated, seasons: TEND.seasons } : null,
    cards: CARDS ? { version: CARDS.version, generated: CARDS.generated } : null,
    ledger: ledger, asks: askLog, events: diagRing
  };
  for (var k in (extra || {})) out[k] = extra[k];
  return JSON.stringify(out);
}

// ---------------------------------------------------------------- buckets
// mirrors engine/buckets.py, per CONTRACT.md
function distanceBand(d) { return d <= 3 ? 'short' : d <= 7 ? 'medium' : 'long'; }
function fieldZone(y) {
  return y >= 80 ? 'own_deep' : y >= 60 ? 'own' : y >= 40 ? 'mid' : y >= 20 ? 'opp' : 'red';
}
function bucketKey(down, dist, ytg) {
  return 'd' + down + '_' + distanceBand(dist) + '_' + fieldZone(ytg);
}
// Whether a released play is the snap a call was made about. Keys are
// "down|distance|yardsToGoal|teamId". ESPN corrects the spot by a yard or
// three between a play's end block and the next play's start block often
// enough (about one snap in fifty) that an exact match would leave those calls
// ungraded. Same offense and same down, and the ball within five yards, is the
// same snap.
function sameSnap(a, b) {
  if (a === b) return true;
  var x = String(a || '').split('|'), y = String(b || '').split('|');
  if (x.length !== 4 || y.length !== 4) return false;
  if (x[3] !== y[3] || x[0] !== y[0]) return false;
  return Math.abs(Number(x[2]) - Number(y[2])) <= 5 && Math.abs(Number(x[1]) - Number(y[1])) <= 5;
}

var shell = {
  bus: bus, esc: esc, $: $, jget: jget, lsGet: lsGet, lsSet: lsSet, rosters: rosters,
  LS: LS, LEAGUES: LEAGUES, API: API, NFL_ALIAS: NFL_ALIAS,
  POLL_MS: POLL_MS, SB_MS: SB_MS, STALE_MS: STALE_MS, TICK_MS: TICK_MS,
  FEED_MAX: FEED_MAX,
  showErr: showErr, seasonsLabel: seasonsLabel,
  distanceBand: distanceBand, fieldZone: fieldZone, bucketKey: bucketKey,
  sameSnap: sameSnap, delayMs: delayMs,
  league: function () { return league; },
  replay: function () { return replayMode; },
  tend: function () { return TEND; },
  history: function () { return HISTORY; },
  cards: function () { return CARDS; },
  shortHints: function () { return shortHints; },
  teachingLevel: function () { return teachingLevel; },
  predictionQuestions: function () { return !replayMode && predictionQuestions; },
  journalReset: function () { journalContext = { key: null, basisPlayId: null, basisRevision: null }; },
  journalGame: journalGame, journalSources: journalSources, journalShown: journalShown,
  journalObservation: journalObservation,
  journalBasis: function (id, revision) { journalContext.basisPlayId = id; journalContext.basisRevision = revision; },
  journalKey: function () { return journalContext.key; },
  bumpExposure: bumpExposure, logAsk: logAsk, invalidateCalls: invalidateCalls,
  calls: function () { return askLog; },
  diag: diag, VERSION: VERSION,
  ledger: function () { return ledger; },
  resetLedger: function () {
    ledger = { concepts: {} }; askLog = [];
    saveLedger(); lsSet(LS.asks, '[]');
  }
};

// ================================================================== PRIME
// Pre-snap only. Nothing in this scope can see an ESPN object.
(function initPrime(sh) {

var fieldStorage;
try { fieldStorage = window.localStorage; } catch (_) {}
var fieldView = window.FootballField.create({ storage: fieldStorage });
var fieldContext = '';
var st = {
  evidence: null, read: null, readHistory: [], past: null, selectionReason: 'snap',
  sit: null, sitKey: '', card: null, ten: null, lesson: null,
  sitLine: '', tendLine: '', watchLine: '', attributed: false, rate: null,
  ask: null,          // {id, kind, q, opts, priority}
  askAt: 0,
  pending: null,      // {sitKey, cardId, askId, kind, concepts, answer, latency}
  res: null,          // resolution strip
  skippedGrade: false,
  sinceAsk: 0,
  gap: 7,
  quiet: 'Pick a game to start.',
  hold: '',
  sig: '', asig: '', journalIds: [], journalSignature: ''
};

// ---------------------------------------------------------------- tendency
// Client port of the reference lookup() in engine/export_tables.py.
// `can_attribute` is read from the file. The client computes no rule of its own.
function leagueRate(key) {
  var row = TENDBASE()[key];
  return row ? row.pass_rate : sh.tend().league_overall.pass_rate;
}
function TENDBASE() { return sh.tend().league_baseline; }

function lookupTendency(teamKey, down, dist, ytg) {
  var T = sh.tend();
  if (!T) return null;
  var key = sh.bucketKey(down, dist, ytg);
  var base = T.league_baseline[key] || null;
  var lr = leagueRate(key);
  var te = teamKey && T.teams[teamKey] ? T.teams[teamKey][key] : null;
  if (te) {
    return {
      bucket: key, team: teamKey, rung: te.rung,
      sample_size: te.sample_size, shrink_weight: te.shrink_weight,
      pass_rate: te.pass_rate, league_pass_rate: lr,
      can_attribute: !!te.can_attribute
    };
  }
  return {
    bucket: key, team: null, rung: 5,
    sample_size: base ? base.sample_size : T.league_overall.sample_size,
    shrink_weight: 0,
    pass_rate: base ? base.pass_rate : null, league_pass_rate: lr,
    can_attribute: false
  };
}
// CONTRACT.md "Client read": a cell whose can_attribute is false is never read
// by copy. The league line for that situation is printed instead.
function printedRate(ten) {
  if (!ten) return null;
  return ten.can_attribute ? ten.pass_rate : ten.league_pass_rate;
}

var NAMEIX = null;
function normName(s) {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bst\.?\b/g, 'state')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function buildNameIndex() {
  NAMEIX = {};
  var T = sh.tend();
  if (!T) return;
  for (var k in T.teams) {
    var n = normName(k);
    if (!(n in NAMEIX)) NAMEIX[n] = k;
  }
}
function resolveTeam(team) {
  var T = sh.tend();
  if (!T || !team) return null;
  if (sh.league() === 'nfl') {
    var a = (team.abbreviation || '').toUpperCase();
    var k = sh.NFL_ALIAS[a] || a;
    return T.teams[k] ? k : null;
  }
  if (!NAMEIX) buildNameIndex();
  var cands = [team.location, team.shortDisplayName, team.displayName, team.name];
  for (var i = 0; i < cands.length; i++) {
    var hit = NAMEIX[normName(cands[i])];
    if (hit) return hit;
  }
  return null;
}
sh.bus.on('tables', function () { NAMEIX = null; st.sig = ''; st.asig = ''; });

// ---------------------------------------------------------------- cards
function cardApplies(c, sit, rate) {
  var a = c.applies || {};
  if (a.down && a.down.indexOf(sit.down) < 0) return false;
  if (a.distance_band && a.distance_band.indexOf(sh.distanceBand(sit.distance)) < 0) return false;
  if (a.field_zone && a.field_zone.indexOf(sh.fieldZone(sit.yardsToGoal)) < 0) return false;
  if (typeof a.min_yards_to_goal === 'number' && sit.yardsToGoal < a.min_yards_to_goal) return false;
  if (typeof a.max_yards_to_goal === 'number' && sit.yardsToGoal > a.max_yards_to_goal) return false;
  if (a.period && a.period.indexOf(sit.period) < 0) return false;
  if (typeof a.max_clock_seconds === 'number') {
    if (sit.clockSeconds === null || sit.clockSeconds > a.max_clock_seconds) return false;
  }
  if (typeof a.min_score_diff === 'number' && (!Number.isFinite(sit.scoreDiff) || sit.scoreDiff < a.min_score_diff)) return false;
  if (typeof a.max_score_diff === 'number' && (!Number.isFinite(sit.scoreDiff) || sit.scoreDiff > a.max_score_diff)) return false;
  // Rate gates read the number the card will actually print, which after
  // shrinkage is the shrunk team rate only when the cell may be attributed.
  if (typeof a.min_pass_rate === 'number') {
    if (rate === null || rate < a.min_pass_rate) return false;
  }
  if (typeof a.max_pass_rate === 'number') {
    if (rate === null || rate > a.max_pass_rate) return false;
  }
  return true;
}
function pickCard(sit, rate) {
  var C = sh.cards();
  if (!C) return null;
  var best = null;
  for (var i = 0; i < C.cards.length; i++) {
    var c = C.cards[i];
    if (!cardApplies(c, sit, rate)) continue;
    if (!best || (c.priority || 0) > (best.priority || 0)) best = c;
  }
  return best;
}
function pct(x) { return String(Math.round(100 * x)); }
function fill(tpl, sit, rate) {
  var s = (tpl || '')
    .replace(/\{distance\}/g, String(sit.distance))
    .replace(/\{yards_to_goal\}/g, String(sit.yardsToGoal))
    .replace(/\{lead\}/g, String(Math.abs(sit.scoreDiff)))
    .replace(/\{pass_rate\}/g, rate === null ? '' : pct(rate))
    .replace(/\{run_rate\}/g, rate === null ? '' : pct(1 - rate));
  return s.replace(/\b1 yards\b/g, '1 yard');
}
function useShortWatch(card) {
  return sh.shortHints() && !!card.prime.watch_short;
}
sh.bus.on('hints', function () {
  if (!st.card || !st.sit) return;
  if (sh.teachingLevel() === 'game') { refreshRead(false); render(); return; }
  st.watchLine = st.lesson ? (sh.shortHints() ? st.lesson.shortWatch : st.lesson.watch) :
    fill(useShortWatch(st.card) ? st.card.prime.watch_short : st.card.prime.watch, st.sit, st.rate);
  render();
});

sh.bus.on('teaching', function () {
  if (!st.sit) return;
  closePending('The teaching mode changed before this pick was resolved.');
  st.res = null;
  setGuidance(false);
  render();
});
sh.bus.on('evidence', function (value) { st.evidence = value; });
sh.bus.on('roster', function () { st.sig = ''; render(); });
sh.bus.on('evidenceChanged', function () {
  if (st.sit && sh.teachingLevel() === 'game') { refreshRead(false); render(); }
});

function refreshRead(remember) {
  var history = st.readHistory.slice();
  var previousKey = st.read && st.read.key;
  st.read = window.FootballRead.select(st.sit, st.evidence, history, st.past);
  st.lesson = st.read && st.read.lessonId ? window.FootballLearning.get(st.read.lessonId, { level: 'game' }) : null;
  st.card = { id: st.read ? st.read.id : 'quiet_read', prints_number: !!st.tendLine, concepts: st.lesson ? st.lesson.concepts : [] };
  st.watchLine = st.read ? st.read.headline : '';
  if (remember || (st.selectionReason === 'context' && previousKey !== (st.read && st.read.key))) {
    st.readHistory.push(st.read ? st.read.key : 'quiet');
    st.readHistory = st.readHistory.slice(-6);
  }
}
function setGuidance(remember) {
  var sit = st.sit, ten = st.ten, rate = st.rate;
  st.past = window.FootballHistory.lookup(sh.history(), sit, sh.league());
  if (sh.teachingLevel() === 'game') {
    st.attributed = !!(ten && ten.can_attribute);
    var late = sit.period === 4 && Number.isFinite(sit.clockSeconds) && sit.clockSeconds <= 300;
    // Situation-only history cannot explain urgent clock decisions or kick/go.
    st.tendLine = sit.down < 4 && !late && rate !== null ?
      (st.attributed ? 'This offense' : 'Offenses') + ' passed on ' + pct(rate) + '% of comparable historical downs.' : '';
    st.sitLine = st.tendLine ? 'Matched by down, distance and field position. Score and clock are not included in this estimate.' : '';
    refreshRead(remember);
  } else {
    st.read = null;
    st.card = pickCard(sit, rate);
    st.lesson = null;
    if (!st.card) { st.watchLine = ''; st.tendLine = ''; st.sitLine = ''; return; }
    st.attributed = !!(ten && ten.can_attribute && st.card.prints_number !== false);
    var pr = st.card.prime;
    st.sitLine = fill(pr.situation, sit, rate);
    st.tendLine = fill(st.attributed ? pr.tendency : (pr.tendency_low || pr.tendency), sit, rate);
    st.watchLine = fill(useShortWatch(st.card) ? (pr.watch_short || pr.watch) : pr.watch, sit, rate);
  }
}
// ---------------------------------------------------------------- the ask
// Every ask is gradeable from the play feed alone. A question the feed cannot
// settle is a question this app has no business asking.
var ASK_KINDS = {
  conversion: {
    q: 'Will this play gain enough for a first down?',
    opts: [{ v: 'past', label: 'First down' }, { v: 'short', label: 'Short' }]
  },
  passrun: {
    q: 'Call it now: throw or run?',
    opts: [{ v: 'pass', label: 'Throw' }, { v: 'run', label: 'Run' }]
  },
  gokick: {
    q: 'Call it now: kick it away, or go for it?',
    opts: [{ v: 'kick', label: 'Kick' }, { v: 'go', label: 'Go for it' }]
  },
  kickrunpass: {
    q: 'Call it now: kick, run, or throw?',
    opts: [{ v: 'kick', label: 'Kick' }, { v: 'run', label: 'Run' }, { v: 'pass', label: 'Throw' }]
  },
  sticks: {
    q: 'Call it now: does this one get past the yellow line?',
    opts: [{ v: 'past', label: 'Past it' }, { v: 'short', label: 'Short' }]
  }
};
function askFor(card) {
  var spec = card.ask;
  if (!spec) return null;
  var kind = ASK_KINDS[spec.kind];
  if (!kind) return null;
  return {
    id: card.id + ':' + spec.kind,
    kind: spec.kind,
    q: spec.q || kind.q,
    opts: kind.opts,
    priority: typeof card.ask_priority === 'number' ? card.ask_priority
            : typeof spec.priority === 'number' ? spec.priority : 50
  };
}
function drawGap() { return 6 + Math.floor(Math.random() * 3); }   // 6, 7 or 8
// Ration: sharp cards get first call on the budget, flat ones wait longer, and
// nothing waits more than gap + 4. Long-run rate lands near one in six to eight.
function askEligible(a) {
  if (!a || !sh.predictionQuestions()) return false;
  if (a.kind === 'passrun' && (st.rate === null || Math.abs(st.rate - 0.5) < 0.08)) return false;
  var g = st.gap;
  var need = a.priority >= 75 ? g - 2 : a.priority >= 50 ? g : g + 2;
  if (need > g + 4) need = g + 4;
  return st.sinceAsk >= need;
}

// ---------------------------------------------------------------- grading
function grade(kind, answer, r) {
  // The result is an observed action, never an inferred play call.
  if (r.voidReason) return { voided: r.voidReason };
  var K = r.kind;
  if (K === 'other') return { voided: 'This play could not be graded. Your pick does not count.' };
  if (kind === 'sticks' || kind === 'conversion') {
    if (r.turnover) return { voided: 'Possession changed on this play. Your yardage pick does not count.' };
    if (K === 'kick') return { voided: 'They kicked. This question only counts on a pass.' };
    if (K === 'run' && kind === 'sticks') return { voided: 'They ran. This question only counts on a pass.' };
    if (typeof r.gained !== 'number' || typeof r.need !== 'number') {
      return { voided: 'The feed is missing the yardage. Your pick does not count.' };
    }
    var truth = r.gained >= r.need ? 'past' : 'short';
    return {
      ok: answer === truth,
      truth: truth === 'past' ? 'It reached the yellow line.' : 'It came up short of the yellow line.'
    };
  }
  if (kind === 'gokick') {
    var t2 = K === 'kick' ? 'kick' : 'go';
    return { ok: answer === t2, truth: t2 === 'kick' ? 'They kicked it.' : 'They went for it.' };
  }
  if (kind === 'kickrunpass' || kind === 'passrun') {
    if (kind === 'passrun' && K === 'kick') {
      return { voided: 'They kicked. Your pick does not count.' };
    }
    return {
      ok: answer === K,
      truth: K === 'pass' ? 'They threw it.' : K === 'run' ? 'They ran it.' : 'They kicked it.'
    };
  }
  return { voided: 'This play could not be graded. Your pick does not count.' };
}

// ---------------------------------------------------------------- events
sh.bus.on('quiet', function (msg) {
  st.quiet = msg || '';
  if (!st.sit) render();
});
// The countdown ticks four times a second. It writes one text node and nothing
// else, so it can never rebuild a button under a finger that is mid-tap.
sh.bus.on('hold', function (n) {
  var s = n > 0 ? 'TV delay: next update in ' + n + 's.' : '';
  if (s !== st.hold) { st.hold = s; $('pHold').textContent = s; }
});
sh.bus.on('transition', function () {
  st.journalIds = []; st.journalSignature = '';
  // A catch-up still closes the old pick at its original boundary, even when
  // the intermediate card itself is never displayed.
  if (closePending('The feed moved on before this pick could be graded.')) st.skippedGrade = true;
});
// The drive ended: touchdown, made kick, end of period. There is no legal next
// snap, so the card comes down rather than describing a down already played.
sh.bus.on('nosnap', function (msg) {
  st.journalIds = []; st.journalSignature = '';
  closePending('The feed moved on before this pick could be graded.');
  st.skippedGrade = false;
  st.quiet = msg || '';
  st.sit = null; st.sitKey = ''; st.card = null; st.ten = null;
  st.lesson = null; st.read = null;
  st.ask = null;
  render();
});
sh.bus.on('clear', function () {
  st.read = null; st.readHistory = []; st.evidence = null;
  st.journalIds = []; st.journalSignature = '';
  window.FootballGlossary.close();
  closePending('The game changed before this pick could be graded.');
  st.sit = null; st.sitKey = ''; st.card = null; st.ten = null;
  st.lesson = null;
  st.ask = null; st.pending = null; st.res = null;
  st.skippedGrade = false;
  st.sinceAsk = 0; st.sig = ''; st.asig = '';
  render();
});

// A play that has already been shown to him. Only ever used to settle a call
// he committed to before it happened.
sh.bus.on('result', function (r) {
  if (r.revised) {
    sh.invalidateCalls(r.game, r.playId);
    if (st.res && st.res.playId === r.playId) {
      st.res = { cls: 'void', head: 'Report corrected.', body: 'ESPN changed this play. Your pick no longer counts.' };
      render();
    }
    renderLedger();
    return;
  }
  var p = st.pending;
  if (!p || !sh.sameSnap(p.sitKey, r.sitKey)) return;
  if (p.answer === null) {
    // He let it go. Take the buttons away rather than leave him able to call a
    // play he has already watched, and say nothing about it.
    logAskRow(p, null, false, r.playId);
    st.pending = null;
    st.ask = null;
    render();
    return;
  }
  st.pending = null;
  var g = grade(p.kind, p.answer, r);
  sh.diag('grade', { sit: r.sitKey, kind: p.kind, answer: p.answer, play: r.kind,
                     ok: g.voided ? null : !!g.ok, latency_ms: p.latency });
  if (g.voided) {
    st.res = { cls: 'void', head: '', body: g.voided };
    logAskRow(p, null, true, r.playId);
  } else {
    st.res = {
      cls: g.ok ? 'ok' : 'no',
      head: g.ok ? 'Good call.' : 'Not this time.',
      body: g.truth
    };
    logAskRow(p, g.ok, false, r.playId);
  }
  st.res.playId = r.playId;
  render();
});

function logAskRow(p, ok, voided, playId) {
  sh.logAsk({
    t: new Date().toISOString(),
    lg: p.league, game: p.game || '', play_id: playId || null,
    card: p.cardId, ask: p.kind, bucket: p.bucket,
    down: p.down, distance: p.distance, yards_to_goal: p.ytg,
    answer: p.answer, correct: ok, voided: !!voided,
    latency_ms: p.answer === null ? null : p.latency
  });
}

function closePending(reason) {
  var p = st.pending;
  if (!p) return;
  logAskRow(p, null, p.answer !== null);
  if (p.answer !== null) {
    st.res = { cls: 'void', head: 'No grade.', body: reason };
    sh.diag('grade', { sit: p.sitKey, kind: p.kind, answer: p.answer, ok: null, reason: reason });
  }
  st.pending = null;
  st.ask = null;
  return p.answer !== null;
}

sh.bus.on('snap', function (sit) {
  window.FootballGlossary.close();
  var missedGrade = closePending('The feed moved on before this pick could be graded.') || st.skippedGrade;
  st.skippedGrade = false;

  st.sit = sit;
  st.selectionReason = 'snap';
  st.sitKey = sit.sitKey;
  st.sinceAsk += 1;

  var teamKey = resolveTeam(sit.offenseTeam);
  var ten = lookupTendency(teamKey, sit.down, sit.distance, sit.yardsToGoal);
  var rate = printedRate(ten);
  var card = pickCard(sit, rate);

  st.ten = ten;
  st.card = card;
  st.journalIds = []; st.journalSignature = '';
  st.rate = rate;
  st.ask = null;
  setGuidance(true);
  card = st.card;
  sh.diag('card', {
    sit: sit.sitKey, team: teamKey, bucket: ten ? ten.bucket : null,
    rung: ten ? ten.rung : null, attr: !!(ten && ten.can_attribute),
    rate: rate, card: card ? card.id : null
  });

  if (card) {
    var question = st.read && st.read.question;
    var a = sh.teachingLevel() === 'game' ? (question ? { id: st.read.id + ':' + question.kind,
      kind: question.kind, q: question.q, opts: ASK_KINDS[question.kind].opts, priority: 80 } : null) : askFor(card);
    if (a && askEligible(a)) {
      st.ask = a;
      st.askAt = Date.now();
      st.sinceAsk = 0;
      st.gap = drawGap();
      if (!missedGrade) st.res = null;      // Keep a newly reported missing grade visible.
      sh.diag('ask', { sit: sit.sitKey, kind: a.kind, card: card.id });
      st.pending = {
        sitKey: sit.sitKey, cardId: card.id, kind: a.kind,
        bucket: ten ? ten.bucket : '', game: sit.gameId || '', league: sh.league(),
        down: sit.down, distance: sit.distance, ytg: sit.yardsToGoal,
        answer: null, latency: 0
      };
    }
    sh.bumpExposure(st.lesson ? st.lesson.concepts : card.concepts);
  }
  render();
  flash();
});

// The same upcoming play can acquire a different clock, score or data-quality
// state. Refresh its read without advancing exposure/cooldown or opening a pick.
sh.bus.on('context', function (sit) {
  if (!st.sit || st.sitKey !== sit.sitKey || st.sit.gameId !== sit.gameId) return;
  var previousCard = st.card && st.card.id;
  st.sit = sit;
  st.selectionReason = 'context';
  setGuidance(false);
  if (st.pending && previousCard !== (st.card && st.card.id)) closePending('The situation changed before this pick was resolved.');
  render();
});

// ---------------------------------------------------------------- render
function flash() {
  var p = $('prime');
  p.classList.add('fresh');
  setTimeout(function () { p.classList.remove('fresh'); }, 60);
}
function quietPrime(msg) {
  $('readLabel').textContent = 'Watch next';
  $('readFeedback').hidden = true;
  $('historyComparison').replaceChildren();
  $('readDetail').textContent = ''; $('readWatch').textContent = ''; $('readSource').textContent = ''; $('readPlayerContext').textContent = '';
  $('prime').className = '';
  $('pQuiet').hidden = false;
  $('pQuiet').textContent = msg;
  document.querySelector('.pTop').hidden = true;
  $('pDD').textContent = '';
  $('pSpot').textContent = '';
  $('pSit').textContent = '';
  $('pTen').textContent = '';
  $('pWatch').textContent = '';
  $('exploreRead').hidden = true;
  $('pFoot').innerHTML = '';
  $('fieldPosition').hidden = true;
  $('fieldView').open = false;
}

// Geometry uses released pre-snap context; orientation is the viewer's TV match.
function renderField(sit) {
  var view = fieldView.view(sit, sh.league()), geo = view.geometry;
  if (!geo) { $('fieldPosition').hidden = true; return; }
  var context = [sh.league(), sit.gameId, sit.period, sit.offenseTeam && sit.offenseTeam.id].join(':');
  if (context !== fieldContext) {
    if ($('fieldView').open && $('fieldView').contains(document.activeElement)) $('fieldViewSummary').focus({ preventScroll: true });
    $('fieldView').open = false; fieldContext = context;
  }
  var offense = sit.offenseTeam.abbreviation || sit.offenseTeam.shortDisplayName || 'Offense';
  function label(team) { return team ? (team.abbreviation || team.shortDisplayName || team.name || 'Team') + ' defends' : ''; }
  $('fieldPosition').hidden = false;
  $('ballLine').setAttribute('x1', geo.ball);
  $('ballLine').setAttribute('x2', geo.ball);
  $('ballMarker').setAttribute('cx', geo.ball);
  $('firstDownLine').setAttribute('x1', geo.target);
  $('firstDownLine').setAttribute('x2', geo.target);
  $('fieldDirection').textContent = view.right ? offense + ' possession →' : '← ' + offense + ' possession';
  $('fieldLeftEnd').textContent = label(view.leftTeam);
  $('fieldRightEnd').textContent = label(view.rightTeam);
  $('fieldTargetLabel').textContent = geo.goal ? 'Goal line' : 'First down';
  $('fieldView').hidden = !view.canMatch;
  $('fieldViewSummary').textContent = view.matched ? 'Flip field' : 'Match TV';
  $('fieldViewPrompt').textContent = 'Which way is ' + offense + ' attacking on your TV?';
  $('fieldAttackLeft').setAttribute('aria-pressed', String(view.matched && !view.right));
  $('fieldAttackRight').setAttribute('aria-pressed', String(view.matched && view.right));
  $('fieldGraphic').setAttribute('aria-label', sit.yardsToGoal + ' yards from the end zone, ' +
    sit.distance + ' yards to ' + (geo.goal ? 'score.' : 'a first down.') + ' ' + offense + ' attacks ' +
    (view.right ? 'right' : 'left') + '. ' + label(view.leftTeam) + ' the left end zone; ' + label(view.rightTeam) +
    ' the right end zone.' + (view.matched ? ' TV direction set by you.' : ' TV direction has not been set.'));
}
function matchField(right) {
  if (!st.sit || !fieldView.match(st.sit, sh.league(), right)) return;
  renderField(st.sit);
  $('fieldView').open = false;
  $('fieldViewSummary').focus({ preventScroll: true });
}
$('fieldAttackLeft').addEventListener('click', function () { matchField(false); });
$('fieldAttackRight').addEventListener('click', function () { matchField(true); });
$('fieldView').addEventListener('keydown', function (event) {
  if (event.key === 'Escape') { event.preventDefault(); $('fieldView').open = false; $('fieldViewSummary').focus({ preventScroll: true }); }
});
// Two signatures, two redraws, deliberately separate. The card above and the
// ask below are torn down only when their own content changed, so a poll, a
// countdown tick or a concept bump can never rebuild a tap target under a
// thumb that is already on its way down.
function cardSig() {
  return [
    st.sitKey, st.card ? st.card.id : '', st.attributed ? 1 : 0, st.rate,
    st.sitLine, st.tendLine, st.watchLine, st.quiet, JSON.stringify(st.read), JSON.stringify(st.past), sh.rosters.revision()
  ].join('|');
}
function askSig() {
  return [
    st.ask ? st.ask.id : '', st.pending && st.pending.answer ? st.pending.answer : '',
    st.res ? st.res.cls + '|' + st.res.head + '|' + st.res.body : ''
  ].join('~');
}
function render() {
  renderAsk();
  // Period/possession can change while the selected text stays the same.
  if (st.sit) renderField(st.sit);
  var sig = cardSig();
  if (sig === st.sig) return;      // nothing on the card changed, do not redraw
  st.sig = sig;

  var sit = st.sit;
  if (!sit) {
    quietPrime(st.quiet);
    $('pHold').textContent = st.hold;
    return;
  }

  $('pQuiet').hidden = true;
  document.querySelector('.pTop').hidden = false;
  $('pDD').textContent = sit.ddText || (sit.down + ' & ' + sit.distance);
  $('pSpot').textContent = sit.yardsToGoal === 50 ? 'At midfield' :
    (sit.spotText ? 'at ' + sit.spotText + ' · ' : '') + sit.yardsToGoal + ' to the end zone';
  $('pHold').textContent = st.hold;

  window.FootballHistoryUI.render($('historyComparison'), st.past);
  $('readLabel').textContent = sh.teachingLevel() === 'game' ?
    (st.read && st.read.focus ? 'Player to watch' : 'What to watch') : 'Where to look';
  st.readView = window.FootballPlayerDisplay.read(st.read, sit.offenseTeam && sit.offenseTeam.id, sh.rosters.resolve);
  $('readDetail').innerHTML = window.FootballGlossary.annotate(st.readView.detail);
  $('readWatch').innerHTML = window.FootballGlossary.annotate(st.readView.watch);
  var supporting = st.read && st.read.supportingPlayer;
  $('readPlayerContext').textContent = st.readView.playerContext;
  $('readSource').textContent = st.read ? st.read.source + (supporting ? ' · ESPN player reports' : '') : '';
  $('readFeedback').hidden = !st.read || sh.replay();
  var feedbackKey = st.sitKey + ':' + (st.read ? st.read.key : '');
  if ($('readFeedback').dataset.key !== feedbackKey) {
    $('readFeedback').dataset.key = feedbackKey;
    $('readFeedback').open = false;
    $('readFeedbackStatus').textContent = '';
  }
  if (sh.teachingLevel() === 'game' && !st.read) {
    $('pQuiet').hidden = false;
    $('pQuiet').textContent = 'No clear read yet. See what changed on the last play.';
  }

  if (!st.card) {
    $('exploreRead').hidden = true;
    $('pSit').textContent = '';
    $('pTen').textContent = '';
    $('pWatch').textContent = '';
    $('pQuiet').hidden = false;
    $('pQuiet').textContent = 'The next situation will appear when the report arrives.';
    $('pFoot').innerHTML = '';
    $('prime').className = '';
    return;
  }

  // The down and distance already have their own heading.
  $('pSit').innerHTML = /^(First|Second|Third|Fourth) and \d+\.$/.test(st.sitLine) ? '' : window.FootballGlossary.annotate(st.sitLine);
  $('pTen').innerHTML = window.FootballGlossary.annotate(st.tendLine);
  $('pWatch').innerHTML = window.FootballGlossary.annotate((st.read ? st.readView.headline : st.watchLine));
  $('exploreRead').hidden = !st.lesson;
  if (st.lesson) {
    $('exploreRead').dataset.lesson = st.lesson.id;
    $('exploreRead').dataset.lessonOrigin = 'live';
    $('exploreRead').dataset.lessonJournalKey = sh.journalKey ? sh.journalKey() : '';
  }
  $('prime').className = st.attributed ? '' : 'low';

  // The source chip is attribution too. It carries the team name on exactly
  // the snaps the copy is allowed to, and never on the rest.
  var chips = [];
  var ten = st.ten;
  var sourceName = sh.league() === 'nfl' ? 'nflverse' : 'CollegeFootballData';
  var sourceLink = '<a class="chip ' + (st.attributed && ten ? 'src' : 'srcl') + '" href="data.html#history" target="_blank" rel="noopener">';
  if (st.attributed && ten) {
    chips.push(sourceLink + esc(ten.team) + ' · ' + sh.seasonsLabel() +
      ' · ' + ten.sample_size + ' plays · ' + sourceName + ' ↗</a>');
  } else {
    chips.push(sourceLink + 'All offenses · ' + sh.seasonsLabel() + ' · ' + sourceName + ' ↗</a>');
  }
  var cs = (st.lesson ? st.lesson.concepts : st.card.concepts) || [];
  for (var i = 0; i < cs.length; i++) {
    if ($('prime').querySelector('.term-link[data-term="' + cs[i] + '"]')) continue;
    chips.push('<button class="chip" data-term="' + esc(cs[i]) + '" aria-haspopup="dialog" aria-controls="termPopover">' + esc(cs[i].replace(/_/g, ' ')) + '</button>');
  }
  $('pFoot').innerHTML = chips.join('');
  captureGuidance();
}
function captureGuidance() {
  if (!st.sit || !st.card || !sh.journalShown) return;
  var lines = { situation: $('pDD').textContent, spot: $('pSpot').textContent,
    context: $('pSit').textContent, tendency: $('pTen').textContent, watch: $('pWatch').textContent,
    detail: $('readDetail').textContent, observation: $('readWatch').textContent,
    playerContext: $('readPlayerContext').textContent,
    historical: $('historyComparison').textContent };
  var visible = document.visibilityState === 'visible' && !document.querySelector('.sheet.on');
  var historyVisible = document.querySelector('.tendency-block').open;
  var signature = JSON.stringify([st.sitKey, lines, visible, historyVisible]);
  if (signature === st.journalSignature) return;
  st.journalSignature = signature;
  var printed = st.card.prints_number !== false && st.tendLine.match(/(\d+)%/);
  var shown = printed && historyVisible ? Number(printed[1]) / 100 : null;
  if (shown !== null && /\brun\b/i.test(st.tendLine)) shown = 1 - shown;
  var result = sh.journalShown({ kind: 'guidance', lines: lines, situation: st.sit,
    cardId: st.card.id, lessonId: st.lesson && st.lesson.id, teachingLevel: sh.teachingLevel(), selectionReason: st.selectionReason,
    historicalVisible: historyVisible,
    historyRefs: st.past ? st.past.rows.map(function (r) { return window.FootballHistory.reference(st.past, r); }) : [],
    read: st.read && { id: st.read.id, version: st.read.version, key: st.read.key, source: st.read.source,
      focus: st.read.focus, supportingPlayer: st.read.supportingPlayer || null,
      identities: st.readView ? st.readView.identities : [],
      playIds: st.read.playIds, historyRefs: st.read.historyRefs || [] },
    probabilityShown: shown, modelProbability: st.ten && st.ten.pass_rate,
    baselineProbability: st.ten && st.ten.league_pass_rate, attributed: st.attributed });
  if (result && result.ok && result.id) st.journalIds.push(result.id);
}
window.addEventListener('football-view-visible', captureGuidance);
document.querySelector('.tendency-block').addEventListener('toggle', function () { st.journalSignature = ''; captureGuidance(); });
$('readFeedback').addEventListener('click', function (event) {
  var button = event.target.closest('[data-read-rating]');
  if (!button || !st.read || !sh.journalObservation) return;
  captureGuidance();
  var shownId = st.journalIds[st.journalIds.length - 1];
  if (!shownId) { $('readFeedbackStatus').textContent = 'This card could not be saved. Check the journal.'; return; }
  var result = sh.journalObservation({ kind: 'read_feedback', shownId: shownId,
    readId: st.read.id, readVersion: st.read.version, rating: button.dataset.readRating });
  $('readFeedbackStatus').textContent = result && result.ok ? 'Saved with this card in your journal.' : 'Feedback could not be saved. Check the journal.';
});
sh.bus.on('result', function (r) {
  // Link only a newly released play whose exact pre-snap situation matches.
  // Corrections, clock matches and approximate spots cannot earn a prediction score.
  if (!sh.journalObservation || r.revised || !st.sit || r.sitKey !== st.sitKey) return;
  st.journalIds.forEach(function (id) {
    sh.journalObservation({ kind: 'resolution', shownId: id, playId: r.playId, voided: !!r.voidReason });
  });
  st.journalIds = [];
});
function renderAsk() {
  var sig = askSig();
  if (sig === st.asig) return;
  st.asig = sig;
  var res = $('pRes'), ask = $('pAsk'), lock = $('askLock'), btns = $('askBtns');
  if (st.res) {
    res.className = 'on ' + st.res.cls;
    res.innerHTML = (st.res.head ? '<b>' + esc(st.res.head) + '</b> ' : '') + esc(st.res.body);
  } else {
    res.className = '';
    res.innerHTML = '';
  }
  if (st.ask && st.pending) {
    ask.className = 'on';
    $('askQ').innerHTML = window.FootballGlossary.annotate(st.ask.q);
    if (st.pending.answer === null) {
      var h = '';
      for (var i = 0; i < st.ask.opts.length; i++) {
        var o = st.ask.opts[i];
        h += '<button class="ansb" data-v="' + esc(o.v) + '">' + esc(o.label) + '</button>';
      }
      btns.innerHTML = h;
      btns.hidden = false;
      lock.hidden = true;
    } else {
      btns.innerHTML = '';
      btns.hidden = true;
      lock.hidden = false;
      lock.innerHTML = 'Your pick: <b>' + esc(labelOf(st.ask, st.pending.answer)) + '</b>';
    }
  } else {
    ask.className = '';
    $('askQ').textContent = '';
    btns.innerHTML = '';
    btns.hidden = false;
    lock.hidden = true;
  }
}
function labelOf(a, v) {
  for (var i = 0; i < a.opts.length; i++) if (a.opts[i].v === v) return a.opts[i].label;
  return v;
}

$('askBtns').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-v]');
  if (!b || !st.pending || st.pending.answer !== null) return;
  st.pending.answer = b.dataset.v;
  st.pending.latency = Math.max(0, Date.now() - st.askAt);
  render();
});
// ---------------------------------------------------------------- ledger view
function renderLedger() {
  var L = sh.ledger().concepts;
  var names = Object.keys(L);
  names.sort(function (a, b) {
    return String(L[b].last_seen || '').localeCompare(String(L[a].last_seen || ''));
  });
  var h = '';
  for (var i = 0; i < names.length; i++) {
    var n = names[i], count = L[n].exposures || 0;
    h += '<div class="lrow"><span class="nm">' + window.FootballGlossary.annotate(n.replace(/_/g, ' ')) + '</span>' +
      '<span class="sc">Seen ' + count + ' time' + (count === 1 ? '' : 's') + '</span></div>';
  }
  $('ledgerView').innerHTML = h ||
    '<div class="lrow"><span class="nm">Terms appear here as you watch.</span></div>';
  var graded = sh.calls().filter(function (r) { return r.answer !== null && !r.voided && typeof r.correct === 'boolean'; });
  var right = graded.filter(function (r) { return r.correct; }).length;
  $('callSummary').textContent = graded.length ? right + ' of ' + graded.length + ' graded picks correct.' : 'No graded picks yet.';
  $('ledgerNote').textContent = 'This records what you have seen. Hints keep their definitions unless you choose shorter hints.';
}
sh.bus.on('sheet', renderLedger);
sh.bus.on('reset', function () { st.sig = ''; st.asig = ''; render(); renderLedger(); });

})(shell);

// =================================================================== LIVE
// Everything ESPN. Allowed to know what happened.
(function initLive(sh) {

var FEED_PREVIEW = 3;
var st = {
  gameId: null, games: [], gameLabel: '', gameState: '',
  gamesLoading: true, gamesLoaded: false, gamesError: '',
  pickerMode: 'current', archiveGames: [], archiveDate: '', archiveLoading: false, archiveError: '',
  sum: null,                 // latest raw summary, this scope only
  seen: {}, order: {}, queue: [], rows: [], released: {}, shownPlay: null, feedExpanded: false,
  health: null, lastQueuedHealth: '', lastChange: 0, syncCandidate: null, syncSample: null, timingBreak: null,
  lastQueuedSit: '', lastQueuedBasis: '', lastQueuedContext: '', lastQueuedBoard: '', shownBoard: null,
  primed: false, lastOk: 0, sheet: false
};

function etDate(offsetDays) {
  var d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d).replace(/-/g, '');
}
function scoreboardUrl(lg, day) {
  return sh.API + sh.LEAGUES[lg].path + '/scoreboard?dates=' + day +
    (lg === 'cfb' ? '&groups=80' : '') + '&limit=200&_=' + Date.now();
}
function summaryUrl(lg, id) {
  return sh.API + sh.LEAGUES[lg].path + '/summary?event=' + id + '&_=' + Date.now();
}
// Scoreboard teams use `logo`; summary teams use a `logos` array.
// Keep the supplied ESPN asset URL instead of guessing from an abbreviation.
function teamLogo(team) {
  if (!team) return '';
  var logos = team.logos || [];
  var primary = logos.filter(function (logo) { return (logo.rel || []).indexOf('default') >= 0; })[0];
  var url = team.logo || (primary && primary.href) || (logos[0] && logos[0].href) || '';
  return /^https:\/\/a\.espncdn\.com\//.test(url) ? url : '';
}
var unavailableLogos = new Set();
function logoImage(url, eager) {
  if (!url || unavailableLogos.has(url)) return '';
  return '<img class="team-logo" src="' + sh.esc(url) + '" width="32" height="32" alt="" aria-hidden="true" loading="' + (eager ? 'eager' : 'lazy') + '" decoding="async">';
}
document.addEventListener('error', function (event) {
  var img = event.target;
  if (img instanceof HTMLImageElement && img.classList.contains('team-logo')) {
    unavailableLogos.add(img.getAttribute('src'));
    img.hidden = true;
  }
}, true);
function normalizeTeamSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function eventRow(e) {
  var c = (e.competitions && e.competitions[0]) || {};
  var cs = c.competitors || [];
  var h = null, a = null;
  for (var i = 0; i < cs.length; i++) {
    if (cs[i].homeAway === 'home') h = cs[i]; else a = cs[i];
  }
  var t = (e.status && e.status.type) || {};
  return {
    id: String(e.id), name: e.shortName || e.name || '?',
    searchText: normalizeTeamSearch([e.name, e.shortName].concat(cs.map(function (competitor) {
      var team = competitor.team || {};
      return [team.displayName, team.shortDisplayName, team.abbreviation, team.location, team.name, team.nickname].join(' ');
    })).join(' ')),
    state: t.state || '?', detail: t.detail || t.shortDetail || '',
    away: a && a.team ? (a.team.shortDisplayName || a.team.abbreviation || '') : '',
    home: h && h.team ? (h.team.shortDisplayName || h.team.abbreviation || '') : '',
    awayLogo: teamLogo(a && a.team), homeLogo: teamLogo(h && h.team),
    awayScore: a ? Number(a.score || 0) : 0,
    homeScore: h ? Number(h.score || 0) : 0
  };
}
// A CFB game that starts Saturday night and runs past midnight ET is on
// yesterday's date while it is still being played. Today's slate is never
// empty on a Saturday, so a "only look back when today is empty" rule never
// fires. Look back whenever nothing is live today.
function fetchGames(lg) {
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, 15000);
  return sh.jget(scoreboardUrl(lg, etDate(0)), controller.signal).then(function (sb) {
    if (!sb || !Array.isArray(sb.events)) throw new Error('Missing schedule');
    var rows = sb.events.map(eventRow);
    if (rows.some(function (r) { return r.state === 'in'; })) return rows;
    return sh.jget(scoreboardUrl(lg, etDate(-1)), controller.signal).then(function (sb2) {
      var y = (sb2.events || []).map(eventRow);
      var live = y.filter(function (r) { return r.state === 'in'; });
      return live.length ? live.concat(rows) : (rows.length ? rows : y);
    }).catch(function () { return rows; });
  }).finally(function () { clearTimeout(timeout); });
}

// Finished-game browsing is independent of the selected live game's polling.
var archiveRequest = null;
function cancelArchive() {
  if (archiveRequest) {
    archiveRequest.controller.abort();
    clearTimeout(archiveRequest.timeout);
  }
  archiveRequest = null;
  st.archiveLoading = false;
}
function loadArchive() {
  cancelArchive();
  st.archiveGames = []; st.archiveError = '';
  var day = $('archiveDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day || day.replace(/-/g, '') > etDate(0)) {
    st.archiveError = 'Choose today or an earlier date.';
    renderPicker();
    return;
  }
  st.archiveDate = day; st.archiveLoading = true;
  var request = { league: sh.league(), controller: new AbortController(), timeout: null };
  archiveRequest = request;
  request.timeout = setTimeout(function () { request.controller.abort(); }, 15000);
  renderPicker();
  sh.jget(scoreboardUrl(request.league, day.replace(/-/g, '')), request.controller.signal).then(function (data) {
    if (archiveRequest !== request || request.league !== sh.league() || st.pickerMode !== 'finished') return;
    if (!Array.isArray(data.events)) throw new Error('Missing schedule');
    st.archiveGames = data.events.map(eventRow).filter(function (game) { return game.state === 'post'; });
  }).catch(function () {
    if (archiveRequest !== request) return;
    st.archiveError = 'Finished games could not be loaded. Try again.';
  }).finally(function () {
    clearTimeout(request.timeout);
    if (archiveRequest !== request) return;
    archiveRequest = null; st.archiveLoading = false;
    renderPicker();
  });
}

// ---------------------------------------------------------------- plays
function collectPlays(sum) {
  var dr = (sum && sum.drives) || {};
  var drives = (dr.previous || []).slice();
  if (dr.current) drives.push(dr.current);
  var seen = {}, out = [];
  for (var i = 0; i < drives.length; i++) {
    var ps = drives[i].plays || [];
    for (var j = 0; j < ps.length; j++) {
      var p = Object.assign({}, ps[j], { driveId: String(drives[i].id || ps[j].driveId || '') }), id = String(p.id);
      if (seen[id] !== undefined) { out[seen[id]] = p; continue; }
      seen[id] = out.length;
      out.push(p);
    }
  }
  return out;
}
// Timeouts, period ends and other markers are not snaps. ESPN writes stale or
// zeroed start and end blocks on them (58 of 1,036 polls over six real games
// had one as the last play), so the situation reader steps back past them and
// the grader never settles a call against one.
function isMarker(p) {
  var t = ((p.type && p.type.text) || '').toLowerCase();
  return t.indexOf('timeout') >= 0 ||
    t.indexOf('end ') === 0 || t.indexOf('end of') === 0 ||
    t.indexOf('two-minute') === 0 || t.indexOf('two minute') === 0 ||
    t.indexOf('official') >= 0 || t.indexOf('coin toss') >= 0;
}
// ESPN's yardsToEndzone sits in the wrong perspective on about two per cent of
// end blocks (21 of 917 over six games, every one exactly 100 minus the truth),
// while possessionText ("OSU 48", "50") was right on all 917. The text is
// trusted only when the number is its exact mirror, so a genuine spot
// correction of a few yards is never second-guessed.
function spotFromText(txt, offAbbr, defAbbr) {
  var t = String(txt || '').trim();
  if (t === '50') return 50;
  var m = /^(\S+)\s+(\d{1,2})$/.exec(t);
  if (!m) return null;
  var side = m[1].toUpperCase(), n = Number(m[2]);
  if (offAbbr && side === String(offAbbr).toUpperCase()) return 100 - n;
  if (defAbbr && side === String(defAbbr).toUpperCase()) return n;
  return null;
}
// One normalisation for both the end block the card is built from and the
// start block a released play is matched by, so the two agree on the key.
function fixSituation(b, offAbbr, defAbbr, newPossession, isEnd) {
  var ytg = b.yardsToEndzone;
  var txt = spotFromText(b.possessionText, offAbbr, defAbbr);
  if (txt !== null && ytg === 100 - txt) ytg = txt;
  var down = b.down, dist = b.distance;
  if (newPossession) {
    // A new possession starts first and ten, or first and goal inside the ten.
    // ESPN sometimes leaves the previous drive's down and distance on the end
    // block (a fumble recovery showed 2nd and 10, a punt return 1st and 6).
    down = 1; dist = Math.min(10, ytg);
  } else if (!(dist >= 1)) {
    // On an end block, distance 0 or negative means the marker was reached and
    // the down has not been advanced yet: it is first and ten. On a start
    // block, distance 0 is how ESPN writes "and goal".
    if (isEnd) { down = 1; dist = Math.min(10, ytg); } else dist = ytg;
  } else if (dist > ytg) {
    dist = ytg;
  }
  return { down: down, distance: dist, yardsToGoal: ytg };
}
function sitKeyOf(fx, teamId) {
  return [fx.down, fx.distance, fx.yardsToGoal, String(teamId)].join('|');
}
function teamAbbrs(sum) {
  var comp = sum && sum.header && sum.header.competitions && sum.header.competitions[0];
  var by = {}, cs = (comp && comp.competitors) || [];
  for (var i = 0; i < cs.length; i++) {
    if (cs[i].team) by[String(cs[i].team.id)] = cs[i].team.abbreviation || cs[i].team.shortDisplayName || '';
  }
  return by;
}
function feedRow(p, abbr, facts) {
  var s = p.start || {};
  return {
    id: String(p.id),
    dd: s.downDistanceText || '',
    off: s.team && s.team.id ? (abbr[String(s.team.id)] || '') : '',
    when: (p.period && p.period.number ? 'Q' + p.period.number + ' ' : '') +
          ((p.clock && p.clock.displayValue) || ''),
    plain: facts.summary, gamePlain: facts.gameSummary, gameConsequence: facts.gameConsequence,
    takeaway: facts.takeaway, provenance: facts.provenance, kind: facts.kind, raw: facts.raw,
    players: facts.players, people: facts.people, teamId: s.team && String(s.team.id || ''),
    facts: facts.facts, consequence: facts.consequence,
    meaning: facts.meaning || '', depthText: facts.depthText || '', depthSource: facts.depthSource,
    related: window.FootballLearning.relatedToReport(facts, { level: sh.teachingLevel ? sh.teachingLevel() : 'game' }),
    reportFirst: /[Ss]ee the play report/.test(facts.consequence),
    awayScore: typeof p.awayScore === 'number' ? p.awayScore : null,
    homeScore: typeof p.homeScore === 'number' ? p.homeScore : null,
    period: p.period && p.period.number ? p.period.number : null,
    clock: (p.clock && p.clock.displayValue) || ''
  };
}

// ---------------------------------------------------- pre-snap whitelist
function clockToSeconds(s) {
  if (!s) return null;
  var m = /^(\d+):(\d{2})$/.exec(String(s).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function trimTeam(t) {
  if (!t) return null;
  return {
    id: String(t.id || ''), abbreviation: t.abbreviation || '',
    location: t.location || '', shortDisplayName: t.shortDisplayName || '',
    displayName: t.displayName || '', name: t.name || ''
  };
}
// Reads the `end` block of the last play that was actually a snap, stepping
// back past timeouts and period markers, whose blocks are stale. ESPN writes
// `down: -1` on the `end` of a play that ended the drive (made field goal,
// touchdown), and that is honoured: when there is no legal next snap the
// answer is no card, and the following kickoff supplies the real one. The end
// of a half is the other case with no next snap, and the clock says so.
//
// This is the only function that writes the object PRIME receives. It copies a
// fixed list of keys. No play text, yardage, scoring flag or turnover flag has
// a path onto the result, so the card pipeline has no outcome to leak.
function preSnap(sum, plays, health) {
  var comp = sum && sum.header && sum.header.competitions && sum.header.competitions[0];
  if (!comp) return null;
  var status = comp.status;
  if (!status || !status.type || status.type.state !== 'in') return null;
  if (status.type.name === 'STATUS_HALFTIME' || status.type.name === 'STATUS_DELAYED') return null;

  var i = plays.length - 1;
  while (i >= 0 && isMarker(plays[i])) i--;
  if (i < 0) return null;
  var p = plays[i], end = p.end;
  if (!end) return null;
  if (!(end.down >= 1 && end.down <= 4)) return null;
  if (typeof end.distance !== 'number') return null;
  if (typeof end.yardsToEndzone !== 'number' || end.yardsToEndzone < 1 || end.yardsToEndzone > 99) return null;
  if (!end.team || !end.team.id) return null;

  var period = Number(status.period || 0);
  var clock = health && health.stalled ? null : clockToSeconds(status.displayClock);
  // Half over, or regulation over: whatever the last end block says, the next
  // thing on the field is a kickoff or nothing.
  if ((period === 2 || period === 4) && clock === 0) return null;

  var offId = String(end.team.id);
  var cs = comp.competitors || [];
  var off = null, def = null;
  for (var j = 0; j < cs.length; j++) {
    if (String(cs[j].team && cs[j].team.id) === offId) off = cs[j]; else def = cs[j];
  }
  if (!off || !def) return null;

  var newPoss = !!(p.start && p.start.team && p.start.team.id && String(p.start.team.id) !== offId);
  var fx = fixSituation(end, off.team.abbreviation, def.team.abbreviation, newPoss, true);
  if (!(fx.yardsToGoal >= 1 && fx.yardsToGoal <= 99)) return null;

  var os = off.score != null && String(off.score).trim() !== '' && Number.isFinite(Number(off.score)) ? Number(off.score) : null;
  var ds = def.score != null && String(def.score).trim() !== '' && Number.isFinite(Number(def.score)) ? Number(def.score) : null;
  return Object.freeze({
    down: fx.down,
    distance: fx.distance,
    yardsToGoal: fx.yardsToGoal,
    period: period,
    season: Number.isInteger(sum.header.season && sum.header.season.year) ? sum.header.season.year : null,
    seasonType: Number.isInteger(sum.header.season && sum.header.season.type) ? sum.header.season.type : null,
    clockSeconds: clock,
    offenseScore: os,
    defenseScore: ds,
    scoreDiff: os !== null && ds !== null ? os - ds : null,
    offenseTeam: trimTeam(off.team),
    defenseTeam: trimTeam(def.team),
    spotText: end.possessionText || '',
    ddText: ['', '1st', '2nd', '3rd', '4th'][fx.down] + ' & ' + (fx.distance >= fx.yardsToGoal ? 'Goal' : fx.distance),
    gameId: String(st.gameId || ''),
    sitKey: sitKeyOf(fx, offId)
  });
}
// The key a released play is matched against, so a call is only ever settled
// by the snap it was made about. Same normalisation as preSnap, so the two
// agree on the key.
function playSitKey(p, abbr) {
  var s = p.start || {};
  if (!s.team || !s.team.id) return '';
  if (!(s.down >= 1 && s.down <= 4) || typeof s.yardsToEndzone !== 'number') return '';
  var offId = String(s.team.id), offA = abbr[offId] || '', defA = '';
  for (var k in abbr) if (k !== offId) defA = abbr[k];
  return sitKeyOf(fixSituation(s, offA, defA, false, false), offId);
}

// ---------------------------------------------------------------- delay queue
function boardSnapshot(sum) {
  var comp = sum && sum.header && sum.header.competitions && sum.header.competitions[0];
  if (!comp) return null;
  var cs = comp.competitors || [], status = comp.status || {}, type = status.type || {};
  function score(side) {
    var c = cs.find(function (item) { return item.homeAway === side; });
    return c && c.score != null && String(c.score).trim() !== '' && Number.isInteger(Number(c.score)) && Number(c.score) >= 0 ? Number(c.score) : null;
  }
  var period = Number(status.period) || 0, clock = String(status.displayClock || '');
  var inPlay = type.state === 'in' && type.name !== 'STATUS_HALFTIME' && type.name !== 'STATUS_DELAYED';
  return { homeScore: score('home'), awayScore: score('away'), period: period,
    detail: inPlay ? (Number.isInteger(period) && period >= 1 ?
      (period > 4 ? 'OT' + (period > 5 ? ' ' + (period - 4) : '') : 'Q' + period) +
      (clockToSeconds(clock) !== null ? ' ' + clock : ' · Clock unavailable') : 'Clock unavailable') :
      (type.shortDetail || type.detail || '') };
}
function due(item) { return item.at === 0 ? 0 : item.at + sh.delayMs(); }
function pump(trigger) {
  var now = Date.now(), moved = false, nextSnap = null;
  var released = [], maxOverdue = 0, journalReleases = [];
  while (st.queue.length && due(st.queue[0]) <= now) {
    var it = st.queue.shift();
    moved = true;
    if (it.kind === 'play') {
      if (!it.wasReleased && !it.silent && !it.marker && !it.row.revised && it.row.observedAt !== null) {
        released.push(it.row.id);
        maxOverdue = Math.max(maxOverdue, now - due(it));
      }
      var index = st.rows.findIndex(function (row) { return row.id === it.row.id; });
      var prior = index >= 0 ? st.rows[index] : null;
      if (index >= 0) st.rows[index] = it.row; else st.rows.push(it.row);
      if (it.source) {
        st.released[it.row.id] = it.source;
        journalReleases.push({ report: it.source, observedAt: it.at, releasedAt: now, source: 'espn' });
      }
      st.rows.sort(function (a, b) { return (st.order[b.id] ?? -1) - (st.order[a.id] ?? -1); });
      if (st.rows.length > sh.FEED_MAX) st.rows.length = sh.FEED_MAX;
      st.shownPlay = st.rows[0] || null;
      // A correction changes the existing report in place. Only changes to
      // grading fields invalidate a past pick; never grade the same play twice.
      var correctedGrade = it.wasReleased && it.priorGradeKey !== it.row.gradeKey;
      if (st.seen[it.row.id]) { st.seen[it.row.id].released = true; st.seen[it.row.id].releasedGradeKey = it.row.gradeKey; }
      if ((!it.wasReleased && !it.silent && !it.marker) || correctedGrade) {
        sh.bus.emit('result', {
          game: st.gameId, playId: it.row.id, revised: !!it.wasReleased,
          sitKey: it.sitKey, kind: it.cls,
          gained: it.gained, need: it.need, turnover: it.turnover, voidReason: it.voidReason
        });
      }
      sh.diag('release', { id: it.row.id, version: it.row.version, revised: !!prior,
        observed_at: it.at, released_at: now, display_id: st.shownPlay && st.shownPlay.id });
    } else if (it.kind === 'snap' || it.kind === 'nosnap') {
      sh.bus.emit('transition');
      nextSnap = it;
    } else if (it.kind === 'context') {
      // If this pump also advances to a new play, publish its final context as
      // one new snap. A context-only refresh never closes an existing pick.
      nextSnap = Object.assign({}, it, { kind: nextSnap && nextSnap.kind !== 'context' ? 'snap' : 'context' });
    } else if (it.kind === 'board') {
      st.shownBoard = it.board;
    } else if (it.kind === 'health') {
      st.health = it.health;
    }
  }
  // Catch-up can release several situations in one turn. Only the final one
  // was actually available to read; intermediate hints must not log learning
  // exposures or open predictions about plays whose results are already here.
  if (moved) renderInsights();
  if (sh.journalSources && journalReleases.length) sh.journalSources(journalReleases);
  if (nextSnap) {
    if (sh.journalBasis) sh.journalBasis(nextSnap.basis, nextSnap.version);
    sh.diag(nextSnap.kind, nextSnap.kind !== 'nosnap' ?
      { sit: nextSnap.sit.sitKey, basis: nextSnap.basis, version: nextSnap.version } : nextSnap.msg);
    sh.bus.emit(nextSnap.kind, nextSnap.kind !== 'nosnap' ? nextSnap.sit : nextSnap.msg);
  }
  if (released.length) sh.diag('queue_release', {
    trigger: trigger || 'tick', ids: released, count: released.length,
    max_overdue_ms: maxOverdue, delay_ms: sh.delayMs()
  });
  if (released.length > 1 && maxOverdue > sh.STALE_MS && trigger !== 'delay_change') {
    st.timingBreak = { at: now, reason: 'queue_catchup' };
  }
  if (moved) {
    if (!nextSnap) sh.bus.emit('evidenceChanged');
    renderFeed(); renderHeader(); refreshSyncCandidate();
  }
  var head = st.queue.length ? Math.ceil((due(st.queue[0]) - now) / 1000) : 0;
  sh.bus.emit('hold', head > 0 ? head : 0);
}

function playFingerprint(p) {
  return JSON.stringify([p.type, p.text, p.statYardage, p.start, p.end, p.scoringPlay,
    p.isPenalty, p.isTurnover, p.pointAfterAttempt, p.scoringType, p.scoreValue,
    p.awayScore, p.homeScore, p.clock, p.period, p.driveId,
    p.airYards, p.yardsAfterCatch, p.air_yards, p.yards_after_catch, p.complete_pass]);
}
function applySummary(sum) {
  st.sum = sum;
  var comp = sum && sum.header && sum.header.competitions && sum.header.competitions[0];
  var status = comp && comp.status;
  sh.rosters.setContext({ league: sh.league(), season: sum && sum.header && sum.header.season && sum.header.season.year,
    teamIds: ((comp && comp.competitors) || []).map(function (c) { return String(c.team && c.team.id || ''); }) });
  st.gameState = (status && status.type && status.type.state) || '';
  st.statusName = (status && status.type && status.type.name) || '';
  var plays = collectPlays(sum), abbr = teamAbbrs(sum);
  if (sh.journalGame) sh.journalGame({ league: sh.league(), gameId: st.gameId, season: sum.header && sum.header.season && sum.header.season.year,
    label: (sum.header && (sum.header.shortName || sum.header.name)) || Object.values(abbr).join(' vs '),
    teams: ((comp && comp.competitors) || []).map(function (c) { return { id: String(c.id),
      abbreviation: c.team && c.team.abbreviation, name: c.team && c.team.displayName, homeAway: c.homeAway }; }),
    status: st.gameState === 'post' ? 'final' : st.gameState === 'in' ? 'live' : 'scheduled' });
  var journalArrivals = [];
  var health = window.FootballFeed.inspectClocks(plays, status || {});
  var first = !st.primed, now = Date.now(), last = plays.length - 1;
  var responseGap = st.lastOk ? now - st.lastOk : null;
  var resumed = !first && responseGap > sh.STALE_MS;
  st.lastOk = now;
  var added = 0, revised = 0, newestKnown = -1;
  st.order = {};
  plays.forEach(function (p, i) {
    st.order[String(p.id)] = i;
    if (st.seen[String(p.id)]) newestKnown = i;
  });
  var freshIds = first ? [] : plays.filter(function (p, i) {
    return i > newestKnown && !st.seen[String(p.id)] && !isMarker(p);
  }).map(function (p) { return String(p.id); });
  // Receipt time is not play time. A group of new reports or the first response
  // after an interruption cannot establish a dependable broadcast delay.
  if (resumed || freshIds.length > 1) {
    st.timingBreak = { at: now, reason: resumed ? 'response_gap' : 'batch' };
  }
  for (var i = 0; i < plays.length; i++) {
    var p = plays[i], id = String(p.id), previous = st.seen[id];
    var fingerprint = playFingerprint(p);
    if (previous && previous.fingerprint === fingerprint) continue;
    journalArrivals.push({ report: p, observedAt: now, source: 'espn' });
    var backlog = first && i < last;
    var backfill = !first && !previous && i < newestKnown;
    var facts = window.FootballPlay.describe(p, abbr);
    var row = feedRow(p, abbr, facts);
    row.version = previous ? previous.version + 1 : 1;
    row.observedAt = previous ? previous.observedAt : first || backfill ? null : now;
    row.timingIssue = previous ? 'revision' : first ? 'history' : backfill ? 'backfill' :
      resumed ? 'response_gap' : freshIds.length > 1 ? 'batch' : null;
    row.revised = !!previous;
    row.marker = isMarker(p);
    row.gradeKey = JSON.stringify([facts.outcome, facts.gained, facts.need, facts.turnover, facts.voidReason, playSitKey(p, abbr)]);
    // Superseded queued reports must not flash or settle a pick while the
    // corrected version is waiting for the same broadcast delay.
    var queuedPlay = st.queue.find(function (item) { return item.kind === 'play' && item.row.id === id; });
    st.queue = st.queue.filter(function (item) {
      var remove = (item.kind === 'snap' || item.kind === 'nosnap' || item.kind === 'context') && item.basis === id;
      if (remove && item.kind !== 'play' && item.basis === st.lastQueuedBasis) st.lastQueuedSit = null;
      return !remove;
    });
    st.seen[id] = { fingerprint: fingerprint, version: row.version, observedAt: row.observedAt,
      released: !!(previous && previous.released), releasedGradeKey: previous && previous.releasedGradeKey };
    if (previous) revised++; else added++;
    var queuedRevision = {
      kind: 'play', at: now, source: p,
      silent: backlog || backfill,
      wasReleased: !!(previous && previous.released), priorGradeKey: previous && previous.releasedGradeKey,
      marker: isMarker(p), row: row,
      cls: facts.outcome, turnover: facts.turnover, voidReason: facts.voidReason,
      sitKey: playSitKey(p, abbr), gained: facts.gained, need: facts.need
    };
    // Keep a corrected report in its original queue position. It still waits
    // for the revision's full TV delay; newer plays cannot jump ahead of it.
    if (queuedPlay) Object.assign(queuedPlay, queuedRevision);
    else st.queue.push(queuedRevision);
  }
  if (sh.journalSources && journalArrivals.length) sh.journalSources(journalArrivals);
  if (added || revised) st.lastChange = now;
  var sit = preSnap(sum, plays, health);
  var basisIndex = last;
  while (basisIndex >= 0 && isMarker(plays[basisIndex])) basisIndex--;
  var basis = basisIndex >= 0 ? String(plays[basisIndex].id) : '';
  var version = st.seen[basis] ? st.seen[basis].version : 0;
  var tail = last >= 0 ? plays[last] : null;
  sh.diag('poll', {
    plays: plays.length, added: added, revised: revised, q: st.queue.length,
    received_at: now, response_gap_ms: responseGap, resumed: resumed,
    new_play_ids: freshIds, batch_size: freshIds.length,
    source_id: tail && String(tail.id), basis_id: basis, source_version: version,
    displayed_id: st.shownPlay && st.shownPlay.id, displayed_version: st.shownPlay && st.shownPlay.version,
    last: tail ? ((tail.type || {}).text || '') : '', sit: sit ? sit.sitKey : null,
    raw_down: tail && tail.end && tail.end.shortDownDistanceText, normalized_down: sit && sit.ddText,
    status: st.statusName, clock: status ? status.displayClock : null, period: status ? status.period : null,
    clock_stalled: health.stalled, repeated_clock_plays: health.repeatedCount,
    last_change_at: st.lastChange, delay_ms: sh.delayMs(), next_release_at: st.queue.length ? due(st.queue[0]) : null
  });
  if (sit) {
    var contextKey = JSON.stringify(sit);
    if (sit.sitKey !== st.lastQueuedSit || basis !== st.lastQueuedBasis) {
      st.lastQueuedSit = sit.sitKey; st.lastQueuedBasis = basis;
      st.queue.push({ kind: 'snap', at: now, sit: sit, basis: basis, version: version });
    } else if (contextKey !== st.lastQueuedContext) {
      st.queue.push({ kind: 'context', at: now, sit: sit, basis: basis, version: version });
    }
    st.lastQueuedContext = contextKey;
  } else if (st.lastQueuedSit !== '' || first) {
    st.lastQueuedSit = ''; st.lastQueuedBasis = basis; st.lastQueuedContext = '';
    st.queue.push({ kind: 'nosnap', at: now, msg: waitingMessage(), basis: basis, version: version });
  } else {
    sh.bus.emit('quiet', waitingMessage());
  }
  var board = boardSnapshot(sum), boardKey = JSON.stringify(board);
  if (boardKey !== st.lastQueuedBoard) {
    st.lastQueuedBoard = boardKey;
    st.queue.push({ kind: 'board', at: now, board: board });
  }
  var healthKey = JSON.stringify(health);
  if (healthKey !== st.lastQueuedHealth) {
    st.lastQueuedHealth = healthKey;
    st.queue.push({ kind: 'health', at: now, health: health });
  }
  st.primed = true;
  pump('poll');
  renderHeader();
  if (resumed || freshIds.length > 1) refreshSyncCandidate();
}
function waitingMessage() {
  if (!st.gameId) return 'Pick a game to start.';
  if (st.gameState === 'pre') return 'Waiting for kickoff.';
  if (st.gameState === 'post') return 'Final. See the last plays below.';
  if (st.statusName === 'STATUS_HALFTIME') return 'Halftime. Waiting for the second half.';
  if (st.statusName === 'STATUS_DELAYED') return 'Game delayed.';
  return 'Waiting for the next play.';
}

// ---------------------------------------------------------------- render
function renderHeader() {
  var sum = st.sum;
  var comp = sum && sum.header && sum.header.competitions && sum.header.competitions[0];
  if (!comp) {
    st.scoreTeams = '';
    $('score').textContent = st.gameId ? 'Loading game…' : 'Choose a game';
    $('hmeta').textContent = '';
  } else {
    var cs = comp.competitors || [];
    var h = null, a = null;
    for (var i = 0; i < cs.length; i++) { if (cs[i].homeAway === 'home') h = cs[i]; else a = cs[i]; }
    var an = a && a.team ? (a.team.abbreviation || a.team.shortDisplayName) : '?';
    var hn = h && h.team ? (h.team.abbreviation || h.team.shortDisplayName) : '?';
    // Clock and score snapshots wait in the same ordered delay queue as plays.
    // They can advance between plays without revealing the raw current score.
    var board = st.shownBoard;
    var as = board && board.awayScore !== null ? board.awayScore : '—';
    var hs = board && board.homeScore !== null ? board.homeScore : '—';
    var awayLogo = teamLogo(a && a.team), homeLogo = teamLogo(h && h.team);
    var teamsKey = JSON.stringify([an, hn, awayLogo, homeLogo]);
    // Keep decoded images attached across polls, clock changes and delayed
    // releases. Only a different team label or logo needs new team markup.
    if (teamsKey !== st.scoreTeams) {
      $('score').innerHTML = '<span class="score-team">' + logoImage(awayLogo, true) + '<span class="team-abbr">' + sh.esc(an) +
        '</span><span class="team-score">' + sh.esc(as) + '</span></span>' +
        '<span class="sep">AT</span><span class="score-team">' + logoImage(homeLogo, true) + '<span class="team-abbr">' +
        sh.esc(hn) + '</span><span class="team-score">' + sh.esc(hs) + '</span></span>';
      st.scoreTeams = teamsKey;
    } else {
      var scores = $('score').querySelectorAll('.team-score');
      scores[0].textContent = as == null ? '' : String(as);
      scores[1].textContent = hs == null ? '' : String(hs);
    }
    var detail = board ? board.detail : sh.delayMs() > 0 ? 'Waiting for TV delay' : 'Waiting for the game update';
    if (st.health && st.health.stalled) detail = 'Q' + st.health.period +
      (sh.replay && sh.replay() ? ' · Reported clock unreliable' : ' · ESPN clock not updating');
    $('hmeta').textContent = detail;
    st.gameLabel = an + ' at ' + hn;
  }
  paintConnection();
}
function paintConnection() {
  if (sh.replay()) {
    $('dot').className = 'dot';
    $('connectionLabel').textContent = 'Replay';
    return;
  }
  var fresh = Date.now() - st.lastOk < (st.gameState === 'post' ? 45000 : sh.STALE_MS);
  var clockBad = st.health && st.health.stalled;
  $('dot').className = 'dot' + (fresh && !clockBad ? ' ok' : '');
  $('connectionLabel').textContent = fresh ? 'Feed responding' : st.gameId ? 'Reconnecting' : 'No game';
  paintFeedStatus();
}
function renderFeed() {
  var el = $('feed');
  var visibleRows = st.feedExpanded ? st.rows : st.rows.slice(0, FEED_PREVIEW);
  var remaining = st.rows.length - visibleRows.length;
  $('feedControls').hidden = st.rows.length <= FEED_PREVIEW;
  $('feedToggle').setAttribute('aria-expanded', String(st.feedExpanded));
  $('feedToggle').textContent = st.feedExpanded ? 'Show fewer plays' : 'Show ' + remaining + ' more ' + (remaining === 1 ? 'play' : 'plays');
  $('feedCount').textContent = 'Showing ' + visibleRows.length + ' of ' + st.rows.length + ' recent plays';
  if (!st.rows.length) {
    el.innerHTML = '<div class="empty">The latest play will appear here.</div>';
    return;
  }
  var expanded = {}, understood = {};
  el.querySelectorAll('details[data-play]').forEach(function (details) { expanded[details.dataset.play] = details.open; });
  el.querySelectorAll('details[data-understand]').forEach(function (details) { understood[details.dataset.understand] = details.open; });
  var basic = sh.teachingLevel() === 'basics';
  el.innerHTML = st.rows.map(function (r, i) {
    var latest = i === 0;
    var detailsOpen = expanded[r.id] === undefined ? r.reportFirst : expanded[r.id];
    var copy = feedCopy(r, i, understood[r.id], detailsOpen);
    var facts = copy.allFacts.map(function (fact) {
      return '<span class="play-fact">' + window.FootballGlossary.annotate(fact) + '</span>';
    }).join('');
    var lesson = r.related ? '<button type="button" class="depth-link" data-lesson="' + sh.esc(r.related.lesson.id) +
      '" data-lesson-origin="reported-play" data-lesson-play="' + sh.esc(r.id) + '" data-lesson-journal-key="' +
      sh.esc(sh.journalKey ? sh.journalKey() : '') + '" data-lesson-context="' + sh.esc(r.related.reason) +
      '" aria-haspopup="dialog" aria-controls="learningSheet">' + sh.esc(r.related.lesson.title) + ' ↗</button>' : '';
    var more = (!latest && r.takeaway ? '<p>' + window.FootballGlossary.annotate(copy.allTakeaway) + '</p>' +
        (r.provenance ? '<p class="depth-caption">' + sh.esc(r.provenance) + '</p>' : '') : '') +
      ((!latest || basic) && r.meaning ? '<p>' + window.FootballGlossary.annotate(r.meaning) + '</p>' : '') +
      (!latest && copy.allConsequence ? '<p>' + window.FootballGlossary.annotate(copy.allConsequence) + '</p>' : '') +
      (!basic && facts ? '<div class="play-facts" aria-label="Details reported by ESPN">' + facts + '</div>' : '') + lesson;
    return '<div class="play' + (latest ? ' latest-play' : ' older-play') + '"' + (i >= visibleRows.length ? ' hidden' : '') + '>' +
      (i === 1 ? '<div class="earlier-label">Earlier</div>' : '') +
      '<div class="pl1">' + (r.off ? '<b>' + sh.esc(r.off) + '</b>' : '') + '<span>' + sh.esc(r.dd) + '</span>' +
      '<span class="t num">' + sh.esc(copy.clock) + '</span></div>' +
      '<div class="pl2 ' + r.kind + '">' + window.FootballGlossary.annotate(copy.summary) + '</div>' +
      (copy.players ? '<p class="play-players">' + sh.esc(copy.players) + '</p>' : '') +
      (copy.takeaway ? '<p class="play-takeaway">' + window.FootballGlossary.annotate(copy.takeaway) + '</p>' : '') +
      (copy.provenance ? '<p class="takeaway-source">' + sh.esc(copy.provenance) + '</p>' : '') +
      (basic && facts ? '<div class="play-facts" aria-label="Details reported by ESPN">' + facts + '</div>' : '') +
      (copy.consequence ? '<p class="play-after">' + window.FootballGlossary.annotate(copy.consequence) + '</p>' : '') +
      (more ? '<details class="play-understand" data-understand="' + sh.esc(r.id) + '"' + (understood[r.id] ? ' open' : '') +
        '><summary>' + (basic ? 'Understand this play' : 'More about this play') + '</summary>' + more + '</details>' : '') +
      (r.raw ? '<details class="play-details" data-play="' + sh.esc(r.id) + '"' + (detailsOpen ? ' open' : '') +
        '><summary>ESPN report' + (r.revised ? ' · updated' : '') + '</summary><p class="pl3">' + sh.esc(r.raw) + '</p></details>' : '') + '</div>';
  }).join('');
  captureFeed();
}
function feedCopy(r, index, understood, expanded) {
  var basic = sh.teachingLevel() === 'basics', latest = index === 0;
  var facts = (r.facts || []).map(function (fact) {
    return basic && fact === 'Shotgun' ? 'Quarterback starts back from center' :
      basic && fact === 'No huddle' ? 'Offense lines up without a huddle' : fact;
  });
  var consequence = basic ? r.consequence : r.gameConsequence;
  var display = window.FootballPlayerDisplay.play(r, sh.rosters.resolve);
  return {
    summary: basic ? r.plain : r.gamePlain,
    consequence: latest ? consequence || null : null, allConsequence: consequence,
    players: display.players, identities: display.identities, situation: r.dd, offense: r.off,
    clock: st.health && st.health.unreliableIds.indexOf(r.id) >= 0 ? (r.period ? 'Q' + r.period : '') : r.when,
    takeaway: latest ? display.takeaway || null : null, allTakeaway: display.takeaway, provenance: latest ? r.provenance : null,
    allFacts: facts, facts: basic || understood ? facts : [],
    meaning: understood && (basic || !latest) ? r.meaning : null,
    detailTakeaway: understood && !latest ? display.takeaway : null,
    detailConsequence: understood && !latest ? consequence : null,
    report: expanded ? r.raw : null
  };
}
function captureFeed() {
  if (!sh.journalShown) return;
  var visibleRows = st.feedExpanded ? st.rows : st.rows.slice(0, FEED_PREVIEW);
  var details = {}, understood = {};
  $('feed').querySelectorAll('details[data-play]').forEach(function (el) { details[el.dataset.play] = el.open; });
  $('feed').querySelectorAll('details[data-understand]').forEach(function (el) { understood[el.dataset.understand] = el.open; });
  st.journalFeed = st.journalFeed || {};
  visibleRows.forEach(function (r, i) {
    if (!st.released[r.id]) return;
    var copy = feedCopy(r, i, understood[r.id], details[r.id] === undefined ? r.reportFirst : details[r.id]);
    // Only record rendered lines, not the private fields used to build details.
    delete copy.allFacts; delete copy.allConsequence; delete copy.allTakeaway;
    var signature = JSON.stringify([r.version, sh.teachingLevel(), copy]);
    if (st.journalFeed[r.id] === signature) return;
    st.journalFeed[r.id] = signature;
    sh.journalShown({ kind: 'play', playId: r.id, report: st.released[r.id],
      facts: window.FootballPlay.describe(st.released[r.id], teamAbbrs(st.sum)), lines: copy,
      teachingLevel: sh.teachingLevel(), historicalOnArrival: r.observedAt === null, timingIssue: r.timingIssue });
  });
}
function renderInsights() {
  var plays = Object.keys(st.released).map(function (id) { return st.released[id]; }).sort(function (a, b) {
    return (st.order[String(a.id)] ?? -1) - (st.order[String(b.id)] ?? -1);
  });
  var summary = window.FootballInsights.summarize(plays, { teamAbbreviations: teamAbbrs(st.sum) });
  sh.bus.emit('evidence', window.FootballInsights.forRead(summary, st.gameId));
  window.FootballDepth.renderInsights(window.FootballPlayerDisplay.insights(summary, sh.rosters.resolve));
}
function ageText(at) {
  if (!at) return 'not yet';
  var seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  return seconds < 2 ? 'just now' : seconds < 60 ? seconds + 's ago' : Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's ago';
}
function paintFeedStatus() {
  $('feedStatus').textContent = !st.gameId ? 'Pick a game to check the feed.' :
    'Feed checked ' + ageText(st.lastOk) + '. Last play update: ' + ageText(st.lastChange) + '.';
  $('clockStatus').textContent = st.health && st.health.stalled ?
    'ESPN’s clock is not updating. Compare the play description with your TV.' :
    'The game clock is reported by ESPN. It is not a running clock or a measure of TV delay.';
}
function refreshSyncCandidate() {
  if (!$('dsheet').classList.contains('on')) return;
  if (st.syncCandidate) {
    var current = st.rows.find(function (row) { return row.id === st.syncCandidate.id; });
    var interrupted = st.timingBreak && st.syncCandidate.observedAt <= st.timingBreak.at;
    if (!current || current.version !== st.syncCandidate.version || interrupted) {
      st.syncCandidate = null; st.syncSample = null;
      $('syncResult').textContent = interrupted ? 'Check a fresh play before setting a delay.' :
        'That report changed. Wait for a fresh play to check TV timing.';
      $('syncApply').hidden = true;
    }
  }
  var latest = st.rows.find(function (row) { return !row.marker; });
  var issue = latest && latest.timingIssue;
  if (st.timingBreak && (!latest || !latest.observedAt || latest.observedAt <= st.timingBreak.at)) issue = st.timingBreak.reason;
  if (!st.syncCandidate && st.syncSample === null && latest && !issue && latest.observedAt != null) st.syncCandidate = latest;
  var row = st.syncCandidate;
  var waiting = issue === 'batch' ? 'Several plays arrived together. Waiting for a fresh play to check TV timing.' :
    issue === 'response_gap' ? 'Updates resumed after a gap. Waiting for a fresh play to check TV timing.' :
    issue === 'queue_catchup' ? 'The app caught up with several updates. Waiting for a fresh play to check TV timing.' : 'Waiting for a newly received play.';
  $('syncPlay').textContent = row ? row.off + ' · ' + row.plain + (row.players ? ' ' + row.players : '') : waiting;
  $('syncSaw').disabled = !row || st.syncSample !== null;
  paintFeedStatus();
}
sh.bus.on('syncOpen', function () {
  st.syncCandidate = null; st.syncSample = null;
  $('syncResult').textContent = '';
  $('syncApply').hidden = true;
  refreshSyncCandidate();
});
$('syncSaw').addEventListener('click', function () {
  var row = st.syncCandidate;
  if (!row || st.syncSample !== null) return;
  var seconds = Math.max(0, Math.round((Date.now() - row.observedAt) / 1000));
  st.syncSample = seconds;
  sh.diag('tv_sync', { game: st.gameId, play: row.id, version: row.version, feed_observed_at: row.observedAt,
    tv_finished_at: Date.now(), measured_seconds: seconds, configured_delay_ms: sh.delayMs() });
  $('syncResult').textContent = seconds > 90 ?
    'This play reached the app ' + seconds + ' seconds before you tapped. That exceeds the 90-second delay limit. Check another play to confirm.' :
    'This play reached the app about ' + seconds + ' seconds before you tapped. Try that delay, then check another play.';
  $('syncApply').textContent = 'Use ' + seconds + 's delay';
  $('syncApply').hidden = seconds > 90;
  refreshSyncCandidate();
});
$('syncAhead').addEventListener('click', function () {
  sh.diag('tv_ahead', { game: st.gameId, display_id: st.shownPlay && st.shownPlay.id,
    last_response_at: st.lastOk, last_play_change_at: st.lastChange, configured_delay_ms: sh.delayMs() });
  $('syncResult').textContent = 'If TV is already ahead, adding delay makes the gap larger. Use 0s; the app has to wait for ESPN to report the play.';
  st.syncCandidate = null; st.syncSample = 0;
  $('syncApply').textContent = 'Use 0s delay';
  $('syncApply').hidden = false;
  $('syncSaw').disabled = true;
});
$('syncApply').addEventListener('click', function () {
  if (st.syncSample === null || st.syncSample > 90) return;
  var seconds = st.syncSample;
  sh.bus.emit('syncApply', seconds);
  $('syncResult').textContent = 'TV delay set to ' + seconds + 's. Reopen this panel to check another play.';
  $('syncApply').hidden = true;
});

function renderPageView() {
  var home = !st.gameId && !sh.replay();
  document.body.dataset.view = home ? 'home' : 'game';
  $('home').hidden = !home;
  var host = home && !st.sheet ? $('homeGamePicker') : $('sheet');
  if ($('gameBrowser').parentElement !== host) host.appendChild($('gameBrowser'));
  var skip = document.querySelector('.skip-link');
  skip.href = home ? '#gameSearch' : '#prime';
  skip.textContent = home ? 'Skip to games' : 'Skip to what to watch';
  if (home || sh.replay()) $('pickBtn').removeAttribute('aria-haspopup');
  else $('pickBtn').setAttribute('aria-haspopup', 'dialog');
}

function renderPicker() {
  renderPageView();
  if (sh.replay()) {
    $('pickBtn').textContent = 'Exit replay';
    $('pickBtn').setAttribute('aria-label', 'Exit replay and return to games');
    $('pickBtn').removeAttribute('aria-haspopup');
    return;
  }
  $('pickBtn').dataset.gameLabel = st.gameLabel;
  $('pickBtn').setAttribute('aria-label', st.gameLabel ? 'Change game, currently ' + st.gameLabel : 'Choose a game');

  var segs = document.querySelectorAll('.seg button');
  for (var i = 0; i < segs.length; i++) {
    segs[i].className = segs[i].dataset.lg === sh.league() ? 'on' : '';
    segs[i].setAttribute('aria-pressed', String(segs[i].dataset.lg === sh.league()));
  }
  var archived = st.pickerMode === 'finished';
  var games = archived ? st.archiveGames : st.games;
  var loading = archived ? st.archiveLoading : st.gamesLoading && !st.gamesLoaded;
  var available = games.filter(function (g) { return archived || g.state === 'in' || g.state === 'pre'; });
  var noSchedule = !archived && !loading && !st.gamesError && !available.length;
  $('scheduleNotice').hidden = archived || (!st.gamesError && !noSchedule);
  $('scheduleMessage').textContent = st.gamesError || (noSchedule
    ? 'No ' + (sh.league() === 'cfb' ? 'college' : 'NFL') + ' games live or scheduled for today. Pick a finished game to try the analysis play by play.' : '');
  $('scheduleRetry').hidden = archived || !st.gamesError;
  $('scheduleRetry').disabled = st.gamesLoading;
  $('browseFinished').hidden = !noSchedule;
  $('currentGamesBtn').setAttribute('aria-pressed', String(!archived));
  $('finishedGamesBtn').setAttribute('aria-pressed', String(archived));
  $('archiveDateField').hidden = !archived;
  $('archiveRetry').hidden = !archived || !st.archiveError;
  var query = normalizeTeamSearch($('gameSearch').value);
  var terms = query ? query.split(' ') : [];
  $('clearGameSearch').hidden = !$('gameSearch').value;
  var matchCount = 0;
  var groups = archived ? [['Finished games', games]] : [
    ['Live now', games.filter(function (g) { return g.state === 'in'; })],
    ['Coming up', games.filter(function (g) { return g.state === 'pre'; })]
  ];
  // Reuse game buttons by ID. Refreshing scores or opening the picker must
  // not restart image loading or replace a button that has keyboard focus.
  var el = $('games'), buttons = new Map(), headings = new Map(), children = [];
  el.querySelectorAll('button[data-g]').forEach(function (button) { buttons.set(button.dataset.g, button); });
  el.querySelectorAll('.grouphead').forEach(function (heading) { headings.set(heading.textContent, heading); });
  for (var gi = 0; gi < groups.length; gi++) {
    var rows = groups[gi][1];
    if (!rows.length) continue;
    var heading = headings.get(groups[gi][0]);
    if (!heading) {
      heading = document.createElement('div');
      heading.className = 'grouphead';
      heading.textContent = groups[gi][0];
    }
    var groupMatches = 0;
    children.push(heading);
    for (var j = 0; j < rows.length; j++) {
      var g = rows[j];
      var sub = g.state === 'post' ? 'Replay game →' : sh.delayMs() > 0 && g.state !== 'pre' ? 'Scores hidden while TV delay is on' : g.state === 'pre' ? g.detail
        : g.away + ' ' + g.awayScore + '  ·  ' + g.home + ' ' + g.homeScore + '  ·  ' + g.detail;
      var button = buttons.get(g.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.g = g.id;
      }
      var teamsKey = JSON.stringify([g.away, g.home, g.awayLogo, g.homeLogo]);
      if (button.dataset.teams !== teamsKey) {
        button.innerHTML = '<span class="game-teams"><span class="game-team">' + logoImage(g.awayLogo) + '<b>' + sh.esc(g.away) +
          '</b></span><span class="game-versus">at</span><span class="game-team">' + logoImage(g.homeLogo) + '<b>' + sh.esc(g.home) +
          '</b></span></span><small></small>';
        button.dataset.teams = teamsKey;
      }
      button.className = 'gbtn' + (g.id === st.gameId ? ' sel' : '');
      button.hidden = !terms.every(function (term) { return g.searchText.indexOf(term) >= 0; });
      if (!button.hidden) groupMatches += 1;
      var detail = button.querySelector('small');
      if (detail.textContent !== sub) detail.textContent = sub;
      children.push(button);
    }
    heading.hidden = !groupMatches;
    matchCount += groupMatches;
  }
  if (!matchCount && !(noSchedule || (!archived && st.gamesError))) {
    var empty = el.querySelector('.empty') || document.createElement('div');
    empty.className = 'empty';
    empty.textContent = loading ? (archived ? 'Loading finished games…' : 'Loading today’s games…') :
      archived && st.archiveError ? st.archiveError : query && available.length
      ? 'No teams match “' + $('gameSearch').value.trim() + '”. Try another name or abbreviation.'
      : 'No finished games on this date. Try another day.';
    children.push(empty);
  }
  // Leave unchanged rows attached; move a row only if the schedule reordered it.
  for (var ci = 0; ci < children.length; ci++) {
    if (el.children[ci] !== children[ci]) el.insertBefore(children[ci], el.children[ci] || null);
  }
  while (el.children.length > children.length) el.lastElementChild.remove();
  var status = query ? matchCount + (matchCount === 1 ? ' game' : ' games') + ' found in ' + (sh.league() === 'cfb' ? 'College' : 'NFL') : '';
  if (archived && !query) status = st.archiveLoading ? 'Loading finished games…' : st.archiveError ||
    matchCount + (matchCount === 1 ? ' finished game' : ' finished games');
  if (!archived && !query && !st.gamesError) status = loading ? 'Updating schedule…' :
    'Today’s games · Eastern time';
  if (loading && query) status = archived ? 'Loading finished games…' : 'Updating schedule…';
  el.setAttribute('aria-busy', String(loading));
  if ($('gameSearchStatus').textContent !== status) $('gameSearchStatus').textContent = status;
}

// ---------------------------------------------------------------- loop
var pollTimer = null, sbTimer = null;
var pollRequest = null, gameGeneration = 0, scoreboardGeneration = 0;
function pollGame() {
  clearTimeout(pollTimer);
  if (sh.replay && sh.replay()) return;
  if (pollRequest) return;
  if (!st.gameId) { pollTimer = setTimeout(pollGame, sh.POLL_MS); return; }
  var t0 = Date.now();
  var request = { generation: gameGeneration, game: st.gameId, league: sh.league(), controller: new AbortController() };
  pollRequest = request;
  var timeout = setTimeout(function () { request.controller.abort(); }, 15000);
  function current() {
    return pollRequest === request && gameGeneration === request.generation &&
      st.gameId === request.game && sh.league() === request.league;
  }
  sh.jget(summaryUrl(request.league, request.game), request.controller.signal).then(function (sum) {
    if (!current()) return;
    sh.showErr('');
    applySummary(sum);
  }).catch(function (e) {
    if (!current()) return;
    sh.diag('err', { where: 'feed', msg: e.message, ms: Date.now() - t0 });
    sh.showErr('Game feed unavailable. Retrying…');
    $('dot').className = 'dot';
  }).then(function () {
    clearTimeout(timeout);
    if (pollRequest !== request) return;
    pollRequest = null;
    pollTimer = setTimeout(pollGame, st.gameState === 'post' ? 30000 : sh.POLL_MS);
  });
}
function pollScoreboard(force, restoreSaved) {
  clearTimeout(sbTimer);
  if (sh.replay && sh.replay()) return;
  if (st.pickerMode === 'finished' || !(force || st.sheet || !st.gameId)) {
    sbTimer = setTimeout(function () { pollScoreboard(false); }, sh.SB_MS);
    return;
  }
  var generation = ++scoreboardGeneration, requestedLeague = sh.league();
  var selectedGeneration = gameGeneration;
  var saved = restoreSaved ? sh.lsGet(sh.LS.game + requestedLeague) : null;
  st.gamesLoading = true;
  renderPicker();
  return fetchGames(requestedLeague).then(function (rows) {
    if (generation !== scoreboardGeneration || requestedLeague !== sh.league()) return;
    st.games = rows; st.gamesLoaded = true; st.gamesError = '';
    var pick = rows.find(function (g) { return g.id === saved && g.state !== 'post'; });
    // A choice made while the schedule loads takes precedence over restoration.
    if (pick && selectedGeneration === gameGeneration && !st.gameId) selectGame(pick.id);
  }).catch(function (e) {
    if (generation !== scoreboardGeneration || requestedLeague !== sh.league()) return;
    sh.diag('err', { where: 'scoreboard', msg: e.message });
    st.gamesError = st.games.length ? 'The schedule could not be refreshed. These listings may be out of date.' :
      'The schedule could not be loaded. Try again, or browse Finished games.';
  }).finally(function () {
    if (generation !== scoreboardGeneration || requestedLeague !== sh.league()) return;
    st.gamesLoading = false;
    renderPicker();
    sbTimer = setTimeout(function () { pollScoreboard(false); }, sh.SB_MS);
  });
}
function resetGame() {
  sh.rosters.clearContext();
  if (sh.journalReset) sh.journalReset();
  gameGeneration += 1;
  clearTimeout(pollTimer);
  if (pollRequest) pollRequest.controller.abort();
  pollRequest = null;
  st.journalFeed = {}; st.sum = null; st.seen = {}; st.order = {}; st.queue = []; st.rows = []; st.released = {}; st.feedExpanded = false;
  window.FootballDepth.renderInsights({ drive: null, teams: [] });
  st.health = null; st.lastQueuedHealth = ''; st.lastChange = 0;
  st.syncCandidate = null; st.syncSample = null; st.timingBreak = null;
  $('syncApply').hidden = true; $('syncResult').textContent = '';
  st.shownPlay = null; st.shownBoard = null; st.lastQueuedBoard = ''; st.lastQueuedContext = '';
  st.lastQueuedSit = ''; st.lastQueuedBasis = ''; st.primed = false;
  st.lastOk = 0; st.gameState = ''; st.statusName = '';
  sh.bus.emit('clear');
}
function clearLeague() {
  cancelArchive();
  st.archiveGames = []; st.archiveError = '';
  scoreboardGeneration += 1;
  st.gameId = null; st.games = []; st.gameLabel = '';
  st.gamesLoading = true; st.gamesLoaded = false; st.gamesError = '';
  resetGame();
  renderPicker(); renderFeed(); renderHeader();
  sh.bus.emit('quiet', 'Loading games…');
}
function selectGame(id) {
  if (!sh.tend()) return;
  st.gameId = String(id);
  sh.diag('game', { id: st.gameId, league: sh.league() });
  resetGame();
  sh.lsSet(sh.LS.game + sh.league(), st.gameId);
  var g = st.games.filter(function (x) { return x.id === st.gameId; })[0];
  if (g) st.gameLabel = g.name;
  renderPicker();
  sh.bus.emit('quiet', waitingMessage());
  renderFeed();
  renderHeader();
  pollGame();
}

// A replay is a separate page session. It never polls a live game, changes
// saved TV delay, or records final reports as if they arrived live.
var replaySession = null, replayCount = null;
function renderReplayControls() {
  var steps = replaySession.steps, index = steps.indexOf(replayCount);
  $('replayPrevious').disabled = index <= 0;
  $('replayNext').disabled = index >= steps.length - 1;
  $('replayNext').textContent = index >= steps.length - 1 ? 'Replay complete' : 'Next play →';
  $('replayMoment').value = replaySession.moments.some(function (m) { return m.count === replayCount; }) ? String(replayCount) : '';
  $('replayStatus').textContent = index === 0 ? 'Before the opening play. Choose Next play to begin.' :
    index === steps.length - 1 ? 'End of the game. Go back or choose another moment.' :
    'Step ' + index + ' of ' + (steps.length - 1);
}
function seekReplay(count) {
  if (!replaySession || replaySession.steps.indexOf(count) < 0) return;
  resetGame();
  st.gameId = replaySession.gameId;
  st.gameLabel = replaySession.label;
  replayCount = count;
  applySummary(window.FootballReplay.snapshot(replaySession, count));
  renderReplayControls();
  var url = new URL(window.location.href);
  url.searchParams.set('at', String(count));
  window.history.replaceState(null, '', url);
}
function startReplay() {
  $('replayControls').hidden = false;
  $('delayBtn').hidden = true;
  $('journalStatus').textContent = 'Replay is not saved';
  sh.bus.emit('quiet', 'Loading the replay…');
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, 15000);
  var request = replayMatch ? sh.jget(summaryUrl(sh.league(), replayMatch[2]), controller.signal) :
    Promise.reject(new Error('Choose a finished game in Games to open a replay.'));
  request.then(function (data) {
    if (!sh.tend() || !sh.cards()) throw new Error('Analysis data is unavailable.');
    replaySession = window.FootballReplay.fromSummary(data, { league: sh.league(), gameId: replayMatch[2], retrievedAt: new Date().toISOString() });
    $('replayGameTitle').textContent = replaySession.label;
    $('replayDate').textContent = new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York'
    }).format(new Date(replaySession.playedAt));
    $('replayMoment').innerHTML = '<option value="">Choose a moment</option>' + replaySession.moments.map(function (m) {
      return '<option value="' + m.count + '">' + sh.esc(m.label) + '</option>';
    }).join('');
    $('replayMoment').disabled = false;
    var requested = new URLSearchParams(window.location.search).get('at');
    var count = requested !== null && /^\d+$/.test(requested) ? Number(requested) : null;
    seekReplay(replaySession.steps.indexOf(count) >= 0 ? count : replaySession.initialCount);
  }).catch(function () {
    $('replayGameTitle').textContent = 'Replay unavailable';
    $('replayStatus').textContent = 'Replay unavailable. It needs a finished game with play reports from ESPN. Refresh to retry, or use Exit replay to choose another game.';
    sh.bus.emit('quiet', 'Replay unavailable.');
  }).finally(function () { clearTimeout(timeout); });
}

// ---------------------------------------------------------------- wiring
$('archiveDate').max = etDate(0).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
$('archiveDate').value = etDate(-1).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
$('currentGamesBtn').addEventListener('click', function () {
  st.pickerMode = 'current'; cancelArchive(); renderPicker(); pollScoreboard(true);
});
$('finishedGamesBtn').addEventListener('click', function () {
  st.pickerMode = 'finished'; loadArchive();
});
$('archiveDate').addEventListener('change', loadArchive);
$('archiveRetry').addEventListener('click', loadArchive);
$('scheduleRetry').addEventListener('click', function () { pollScoreboard(true); });
$('browseFinished').addEventListener('click', function () {
  $('finishedGamesBtn').click();
  $('archiveDate').focus();
});
$('replayPrevious').addEventListener('click', function () {
  if (replaySession) seekReplay(replaySession.steps[replaySession.steps.indexOf(replayCount) - 1]);
});
$('replayNext').addEventListener('click', function () {
  if (replaySession) seekReplay(replaySession.steps[replaySession.steps.indexOf(replayCount) + 1]);
});
$('replayMoment').addEventListener('change', function () {
  if (this.value !== '') seekReplay(Number(this.value));
});
document.addEventListener('keydown', function (event) {
  if (!sh.replay() || !replaySession || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  if (document.querySelector('.sheet.on, :popover-open')) return;
  if (event.target.closest('input, select, textarea, a, [contenteditable]') ||
      (event.target.closest('button') && !event.target.closest('.replay-step-buttons'))) return;
  event.preventDefault();
  seekReplay(replaySession.steps[replaySession.steps.indexOf(replayCount) + (event.key === 'ArrowRight' ? 1 : -1)]);
});
$('feed').addEventListener('toggle', captureFeed, true);
sh.bus.on('teaching', renderFeed);
// Repaint only already released reports; a roster response is not a new play.
sh.bus.on('roster', function () { renderFeed(); renderInsights(); });
$('feedToggle').addEventListener('click', function () {
  st.feedExpanded = !st.feedExpanded;
  renderFeed();
  if (!st.feedExpanded) {
    this.scrollIntoView({ block: 'nearest' });
    this.focus({ preventScroll: true });
  }
});
$('pickBtn').addEventListener('click', function () {
  if (sh.replay()) { window.location.assign(window.location.pathname); return; }
  if (!st.gameId) {
    $('gameSearch').scrollIntoView({ block: 'center' });
    $('gameSearch').focus({ preventScroll: true });
    return;
  }
  st.sheet = true;
  $('sheet').className = 'sheet on';
  renderPicker();
  $('gameBrowser').scrollTop = 0;
  sh.bus.emit('sheet');
  if (st.pickerMode === 'finished') loadArchive();
  else pollScoreboard(true);
});
function closeSheet() { st.sheet = false; $('sheet').className = 'sheet'; renderPageView(); }
$('closeSheet').addEventListener('click', closeSheet);
$('sheet').addEventListener('click', function (ev) { if (ev.target === $('sheet')) closeSheet(); });
$('gameSearch').addEventListener('input', renderPicker);
$('clearGameSearch').addEventListener('click', function () {
  $('gameSearch').value = '';
  renderPicker();
  $('gameSearch').focus();
});
$('games').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-g]');
  if (!b) return;
  var rows = st.pickerMode === 'finished' ? st.archiveGames : st.games;
  var game = rows.find(function (g) { return g.id === b.dataset.g; });
  if (game && game.state === 'post') {
    window.location.assign('?replay=' + sh.league() + ':' + game.id);
    return;
  }
  var fromHome = !st.sheet;
  selectGame(b.dataset.g);
  closeSheet();
  if (fromHome) {
    $('prime').focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }
});
sh.bus.on('leagueChanging', clearLeague);
sh.bus.on('leagueChanged', function () {
  if (st.pickerMode === 'finished') { loadArchive(); return; }
  pollScoreboard(true, true);
});
sh.bus.on('delay', function () { pump('delay_change'); renderHeader(); renderPicker(); });

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') pollGame();
});
setInterval(pump, sh.TICK_MS);
setInterval(paintConnection, 1000);

renderPageView();
sh.bus.on('boot', function () {
  renderHeader();
  renderPicker();
  if (sh.replay()) { startReplay(); return; }
  pollScoreboard(true, true);
  pollGame();
});

})(shell);

// ================================================================= shell wiring
function openSettings() {
  $('settingsSheet').classList.add('on');
  bus.emit('sheet');
}
$('settingsBtn').addEventListener('click', openSettings);
$('gameSettingsBtn').addEventListener('click', function () {
  $('closeSheet').click();
  openSettings();
});
$('closeSettings').addEventListener('click', function () { $('settingsSheet').classList.remove('on'); });
$('settingsSheet').addEventListener('click', function (ev) {
  if (ev.target === this) this.classList.remove('on');
});
$('predictionQuestions').checked = !replayMode && predictionQuestions;
$('predictionQuestions').disabled = replayMode;
if (replayMode) $('predictionNote').textContent = 'Predictions are paused in replay. Your saved setting is unchanged.';
$('predictionQuestions').addEventListener('change', function () {
  predictionQuestions = this.checked;
  lsSet(LS.questions, predictionQuestions ? '1' : '0');
  bus.emit('teaching');
});
$('teachingLevel').value = teachingLevel;
window.FootballDepth.setTeachingLevel(teachingLevel);
$('teachingLevel').addEventListener('change', function () {
  teachingLevel = this.value === 'basics' ? 'basics' : 'game';
  lsSet(LS.teachingLevel, teachingLevel);
  window.FootballDepth.setTeachingLevel(teachingLevel);
  bus.emit('teaching');
});
$('shortHints').checked = shortHints;
$('shortHints').addEventListener('change', function () {
  shortHints = this.checked;
  lsSet(LS.shortHints, shortHints ? '1' : '0');
  bus.emit('hints');
});
function paintDelay() {
  $('dVal').textContent = delaySec + 's';
  $('dSlide').value = String(delaySec);
  $('delayBtn').textContent = delayConfigured ? 'TV +' + delaySec + 's' : 'Sync TV';
  $('delayBtn').className = delaySec > 0 ? 'on' : '';
  $('dNote').textContent = !delayConfigured
    ? 'Starting at 45 seconds. This is a guess, not a measured match to your TV. Adjust it below or check your timing with a fresh play.'
    : delaySec === 0
    ? 'No delay. Updates appear as they arrive.'
    : 'Updates wait ' + delaySec + ' second' + (delaySec === 1 ? '' : 's') + '.';
}
function setDelay(n) {
  n = Math.max(0, Math.min(MAX_DELAY, Math.round(n)));
  if (!isFinite(n) || (n === delaySec && delayConfigured)) return;
  delayConfigured = true;
  delaySec = n;
  lsSet(LS.delay, String(n));
  paintDelay();
  bus.emit('delay', n);
}
$('delayBtn').addEventListener('click', function () { $('dsheet').className = 'sheet on'; bus.emit('syncOpen'); });
bus.on('syncApply', function (seconds) { setDelay(seconds); });
$('closeDelay').addEventListener('click', function () { $('dsheet').className = 'sheet'; });
$('dsheet').addEventListener('click', function (ev) {
  if (ev.target === $('dsheet')) $('dsheet').className = 'sheet';
});
$('dSlide').addEventListener('input', function () { setDelay(Number(this.value)); });
$('dMinus').addEventListener('click', function () { setDelay(delaySec - 1); });
$('dPlus').addEventListener('click', function () { setDelay(delaySec + 1); });

$('resetLedger').addEventListener('click', function () {
  shell.resetLedger();
  bus.emit('reset');
});
// Everything the app logged, for a debrief after a game. Clipboard first, the
// share sheet as the fallback, and either way nothing leaves the phone until
// he decides where to paste it.
$('copyDiag').addEventListener('click', function () {
  var text = diagPayload({ game_label: $('pickBtn').dataset.gameLabel || '' });
  var btn = $('copyDiag');
  function done(msg) {
    btn.textContent = msg;
    setTimeout(function () { btn.textContent = 'Copy diagnostics'; }, 2500);
  }
  var p = (navigator.clipboard && navigator.clipboard.writeText)
    ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard'));
  p.then(function () { done('Copied.'); }).catch(function () {
    if (navigator.share) {
      navigator.share({ title: 'Fluent in Football diagnostics', text: text })
        .then(function () { done('Shared.'); }).catch(function () { done('Could not copy.'); });
    } else done('Could not copy.');
  });
});
$('buildNote').textContent = 'build ' + VERSION;
document.querySelector('.seg').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-lg]');
  if (!b || b.dataset.lg === league) return;
  league = b.dataset.lg;
  var requestedLeague = league;
  lsSet(LS.league, league);
  bus.emit('leagueChanging');
  TEND = null; HISTORY = null;
  bus.emit('tables');
  loadTables().then(function () {
    if (requestedLeague !== league) return;
    bus.emit('tables');
    bus.emit('leagueChanged', league);
  }).catch(function (e) {
    if (requestedLeague === league) showErr('Football stats could not be loaded. Refresh to try again.');
  });
});

// keep the screen awake; harmless where unsupported
function keepAwake() {
  if (!navigator.wakeLock) return;
  navigator.wakeLock.request('screen').then(function () {}).catch(function () {});
}
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') keepAwake();
});

function loadTables() {
  var requestedLeague = league;
  return Promise.all([
    jget(LEAGUES[requestedLeague].table).then(function (t) { if (requestedLeague === league) TEND = t; }),
    jget('history-' + requestedLeague + '.json').then(function (h) { if (requestedLeague === league) HISTORY = h; })
      .catch(function () { if (requestedLeague === league) HISTORY = null; })
  ]);
}

loadLedger();
loadAsks();
loadDiag();
diag('boot', { version: VERSION, league: league, delay: delaySec });
paintDelay();

Promise.all([
  jget('cards.json').then(function (c) { CARDS = c; window.FootballGlossary.configure(c.concepts); }),
  loadTables(),
  jget('build-info.json').then(function (info) { artifacts.build = info; }).catch(function () {})
]).then(function () {
  bus.emit('tables');
  bus.emit('boot');
  keepAwake();
}).catch(function (e) {
  diag('err', { where: 'startup', msg: e.message });
  showErr('Football stats could not be loaded. Refresh to try again.');
  bus.emit('boot');
});

})();

'use strict';
/*
 * Football Companion, live page.
 *
 * THREE SCOPES. The walls between them are the design, not decoration.
 *
 *   SHELL   Config, storage, tendency tables, card library, both settings
 *           sheets. Holds no ESPN object of any kind, ever.
 *
 *   LIVE    Everything ESPN: scoreboard, summary, plays, the recent-plays
 *           feed, the score in the header. This scope is allowed to know what
 *           happened. It reaches the rest of the app through `bus` and through
 *           nothing else.
 *
 *   PRIME   The card. Situation, tendency, watch instruction, the ask. It is a
 *           sibling scope of LIVE, so no ESPN variable is in its lexical scope
 *           at all. It receives exactly two records:
 *             bus 'snap'    a frozen pre-snap whitelist, built in LIVE by
 *                           copying a fixed list of keys. No play text, yards
 *                           gained, scoring flag or turnover flag exists on it.
 *             bus 'result'  four scalars describing a play that has ALREADY
 *                           been released to his screen, used only to resolve
 *                           a call he already committed to. It arrives after
 *                           the reveal, never before it.
 *
 * DELAY QUEUE, in LIVE. Nothing reaches the screen, card or feed or score,
 * before observed_at + the user's broadcast delay. The delay is a setting,
 * 0 to 60 seconds, default 0, persisted, changeable mid-game. Raising it
 * re-bases everything still waiting.
 *
 * THE ASK, in PRIME. Temporal occlusion: commit before the reveal. Rationed to
 * roughly one snap in six to eight, never two in a row, higher ask_priority
 * cards get first call on the budget. Answer and latency are both persisted,
 * and the concept ledger sequences on speed-of-correct-call, not on how many
 * times a word has been printed.
 *
 * No backend. The browser talks to ESPN directly (ESPN 403s datacenter IPs but
 * serves access-control-allow-origin: *). No LLM calls. No login, ever.
 */
(function () {

// ==================================================================== shell
var VERSION = '2026-09-05-ux';
var POLL_MS = 3000;          // selected game, summary endpoint
var SB_MS = 12000;           // scoreboard, only while picking a game
var STALE_MS = 9000;         // live dot goes red after this
var TICK_MS = 250;           // delay queue pump
var FEED_MAX = 25;
var MAX_DELAY = 90;          // streaming services can trail cable by more than a minute
var FAST_MS = 4000;          // a call this quick, and right, counts as mastery
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
  ledger: 'fc_ledger', asks: 'fc_asks', delay: 'fc_delay', diag: 'fc_diag'
};
var DIAG_MAX = 500;

var $ = function (id) { return document.getElementById(id); };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function jget(url) {
  return fetch(url, { cache: 'no-store' }).then(function (r) {
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
var league = lsGet(LS.league) === 'nfl' ? 'nfl' : 'cfb';
var delaySec = (function () {
  var n = parseInt(lsGet(LS.delay), 10);
  return (isFinite(n) && n >= 0 && n <= MAX_DELAY) ? n : 0;
})();
var TEND = null;    // tendency table for the current league
var CARDS = null;   // cards.json

function delayMs() { return delaySec * 1000; }
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
// One record per concept. Exposure is kept because the card library needs to
// know a word has been printed, but it is the weakest signal here: a concept
// only reaches `familiar` on two consecutive correct calls made inside
// FAST_MS, and a concept he has attempted and missed is held at `introduced`
// no matter how often he has seen it.
var ledger = { concepts: {} };
function loadLedger() {
  try {
    var d = JSON.parse(lsGet(LS.ledger) || 'null');
    if (d && d.concepts) ledger = d;
  } catch (e) { ledger = { concepts: {} }; }
}
function saveLedger() { lsSet(LS.ledger, JSON.stringify(ledger)); }
function rec(c) {
  var r = ledger.concepts[c];
  if (!r) r = ledger.concepts[c] = {};
  r.exposures = r.exposures || 0;
  r.attempts = r.attempts || 0;
  r.correct = r.correct || 0;
  r.streak = r.streak || 0;
  r.fast_ms = r.fast_ms || 0;
  return r;
}
function conceptState(c) {
  var r = ledger.concepts[c];
  if (!r || !r.exposures) return 'unknown';
  if (r.correct >= 1 && r.streak >= 2 && r.fast_ms > 0 && r.fast_ms <= FAST_MS) return 'familiar';
  if (r.correct >= 1) return 'learning';
  if ((r.attempts || 0) >= 2) return 'introduced';   // tried, not right yet
  if (r.exposures >= 2) return 'learning';
  return 'introduced';
}
function knows(c) {
  var s = conceptState(c);
  return s === 'learning' || s === 'familiar';
}
function bumpExposure(list) {
  if (!list || !list.length) return;
  var now = new Date().toISOString();
  for (var i = 0; i < list.length; i++) {
    var r = rec(list[i]);
    r.exposures += 1;
    r.last_seen = now;
    r.state = conceptState(list[i]);
  }
  saveLedger();
}
// Kellman: sequence on accuracy AND response time.
function recordCall(list, ok, latencyMs) {
  if (!list || !list.length) return;
  var now = new Date().toISOString();
  for (var i = 0; i < list.length; i++) {
    var c = list[i], r = rec(c);
    r.attempts += 1;
    r.last_seen = now;
    if (ok) {
      r.correct += 1;
      r.streak += 1;
      // exponential moving average over correct calls only
      r.fast_ms = r.fast_ms ? Math.round(0.6 * r.fast_ms + 0.4 * latencyMs) : latencyMs;
    } else {
      r.streak = 0;
    }
    r.state = conceptState(c);
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
  askLog.push(row);
  if (askLog.length > ASK_LOG_MAX) askLog = askLog.slice(-ASK_LOG_MAX);
  lsSet(LS.asks, JSON.stringify(askLog));
}

// ---------------------------------------------------------------- diagnostics
// A ring of the last DIAG_MAX events (polls, snaps, results, cards, errors),
// kept in the browser so a live test can be debriefed afterwards. Nothing in it
// leaves the phone unless he taps "Copy diagnostics". It records what the app
// did and when; it never records anything the card was not allowed to see.
var diagRing = [];
var diagDirty = false;
function loadDiag() {
  try {
    var d = JSON.parse(lsGet(LS.diag) || 'null');
    if (d && d.length) diagRing = d.slice(-DIAG_MAX);
  } catch (e) { diagRing = []; }
}
function diag(kind, data) {
  var row = { t: Date.now(), k: kind };
  if (data !== undefined) row.d = data;
  diagRing.push(row);
  if (diagRing.length > DIAG_MAX) diagRing = diagRing.slice(-DIAG_MAX);
  diagDirty = true;
}
setInterval(function () {
  if (!diagDirty) return;
  diagDirty = false;
  lsSet(LS.diag, JSON.stringify(diagRing));
}, 2000);
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
  bus: bus, esc: esc, $: $, jget: jget, lsGet: lsGet, lsSet: lsSet,
  LS: LS, LEAGUES: LEAGUES, API: API, NFL_ALIAS: NFL_ALIAS,
  POLL_MS: POLL_MS, SB_MS: SB_MS, STALE_MS: STALE_MS, TICK_MS: TICK_MS,
  FEED_MAX: FEED_MAX, FAST_MS: FAST_MS,
  showErr: showErr, seasonsLabel: seasonsLabel,
  distanceBand: distanceBand, fieldZone: fieldZone, bucketKey: bucketKey,
  sameSnap: sameSnap, delayMs: delayMs,
  league: function () { return league; },
  tend: function () { return TEND; },
  cards: function () { return CARDS; },
  conceptState: conceptState, knows: knows,
  bumpExposure: bumpExposure, recordCall: recordCall, logAsk: logAsk,
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

var st = {
  sit: null, sitKey: '', card: null, ten: null,
  sitLine: '', tendLine: '', watchLine: '', attributed: false, rate: null,
  ask: null,          // {id, kind, q, opts, priority}
  askAt: 0,
  pending: null,      // {sitKey, cardId, askId, kind, concepts, answer, latency}
  res: null,          // resolution strip
  sinceAsk: 99,       // start high so the mechanic shows itself on the first card
  gap: 7,
  quiet: 'Pick a game to start.',
  hold: '',
  openConcept: null,
  sig: '', asig: ''
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
  if (typeof a.min_score_diff === 'number' && sit.scoreDiff < a.min_score_diff) return false;
  if (typeof a.max_score_diff === 'number' && sit.scoreDiff > a.max_score_diff) return false;
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
  var cs = card.concepts || [];
  if (!cs.length) return false;
  for (var i = 0; i < cs.length; i++) if (!sh.knows(cs[i])) return false;
  return true;
}

// ---------------------------------------------------------------- the ask
// Every ask is gradeable from the play feed alone. A question the feed cannot
// settle is a question this app has no business asking.
var ASK_KINDS = {
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
// Fallback ask table, keyed by card id. `cards.json` may ship its own `ask`
// and `ask_priority` per card; when it does, the file wins and this is unused.
var ASKS = {
  lead_late_clock:          { kind: 'passrun', priority: 78 },
  trail_late_deep_safeties: { kind: 'passrun', priority: 78 },
  d4_short_go:              { kind: 'kickrunpass', priority: 85 },
  d4_kick_likely:           { kind: 'gokick', priority: 85 },
  d3_medium_sticks:         { kind: 'sticks', priority: 80 },
  d3_long_safeties:         { kind: 'sticks', priority: 80 },
  d3_short_line:            { kind: 'passrun', priority: 72 },
  d1_run_lean_play_action:  { kind: 'passrun', priority: 72 },
  d1_pass_lean_cushion:     { kind: 'passrun', priority: 70 },
  d2_short_safety_creep:    { kind: 'passrun', priority: 66 },
  goal_line_bodies:         { kind: 'passrun', priority: 62 },
  d3_own_half_blitz:        { kind: 'passrun', priority: 60 },
  two_minute_sideline:      { kind: 'passrun', priority: 56 },
  red_zone_slot:            { kind: 'passrun', priority: 56 },
  d2_long_zone_drop:        { kind: 'passrun', priority: 54 },
  backed_up_pocket:         { kind: 'passrun', priority: 50 },
  d2_medium_motion:         { kind: 'passrun', priority: 46 },
  d1_box_count:             { kind: 'passrun', priority: 40 }
};
function askFor(card) {
  var spec = card.ask || ASKS[card.id] || null;
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
  if (!a) return false;
  var g = st.gap;
  var need = a.priority >= 75 ? g - 2 : a.priority >= 50 ? g : g + 2;
  if (need > g + 4) need = g + 4;
  return st.sinceAsk >= need;
}

// ---------------------------------------------------------------- grading
function grade(kind, answer, r) {
  // r: {kind:'pass'|'run'|'kick'|'other', gained, need}
  var K = r.kind;
  if (K === 'other') return { voided: 'This play could not be graded. Your pick does not count.' };
  if (kind === 'sticks') {
    if (K === 'kick') return { voided: 'They kicked. This question only counts on a pass.' };
    if (K === 'run') return { voided: 'They ran. This question only counts on a pass.' };
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
// The drive ended: touchdown, made kick, end of period. There is no legal next
// snap, so the card comes down rather than describing a down already played.
sh.bus.on('nosnap', function (msg) {
  st.quiet = msg || '';
  st.sit = null; st.sitKey = ''; st.card = null; st.ten = null;
  st.ask = null; st.openConcept = null;
  render();
});
sh.bus.on('clear', function () {
  st.sit = null; st.sitKey = ''; st.card = null; st.ten = null;
  st.ask = null; st.pending = null; st.res = null; st.openConcept = null;
  st.sinceAsk = 99; st.sig = ''; st.asig = '';
  render();
});

// A play that has already been shown to him. Only ever used to settle a call
// he committed to before it happened.
sh.bus.on('result', function (r) {
  var p = st.pending;
  if (!p || !sh.sameSnap(p.sitKey, r.sitKey)) return;
  if (p.answer === null) {
    // He let it go. Take the buttons away rather than leave him able to call a
    // play he has already watched, and say nothing about it.
    logAskRow(p, null, false);
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
    st.res = { cls: 'void', head: '', body: g.voided, why: '' };
    logAskRow(p, null, true);
  } else {
    st.res = {
      cls: g.ok ? 'ok' : 'no',
      head: g.ok ? 'Good call.' : 'Not this time.',
      body: g.truth,
      why: p.explain || ''
    };
    sh.recordCall(p.concepts, g.ok, p.latency);
    logAskRow(p, g.ok, false);
  }
  render();
});

function logAskRow(p, ok, voided) {
  sh.logAsk({
    t: new Date().toISOString(),
    lg: sh.league(), game: p.game || '',
    card: p.cardId, ask: p.kind, bucket: p.bucket,
    down: p.down, distance: p.distance, yards_to_goal: p.ytg,
    answer: p.answer, correct: ok, voided: !!voided,
    latency_ms: p.answer === null ? null : p.latency
  });
}

sh.bus.on('snap', function (sit) {
  // An ask he ignored closes out silently. No nag, no second chance.
  if (st.pending) {
    if (st.pending.answer === null) logAskRow(st.pending, null, false);
    st.pending = null;
  }

  st.sit = sit;
  st.sitKey = sit.sitKey;
  st.sinceAsk += 1;

  var teamKey = resolveTeam(sit.offenseTeam);
  var ten = lookupTendency(teamKey, sit.down, sit.distance, sit.yardsToGoal);
  var rate = printedRate(ten);
  var card = pickCard(sit, rate);

  st.ten = ten;
  st.card = card;
  st.rate = rate;
  st.ask = null;
  sh.diag('card', {
    sit: sit.sitKey, team: teamKey, bucket: ten ? ten.bucket : null,
    rung: ten ? ten.rung : null, attr: !!(ten && ten.can_attribute),
    rate: rate, card: card ? card.id : null
  });

  if (card) {
    // Copy register and variant are frozen here, once, for this snap. Nothing
    // may rewrite the sentence he is halfway through reading.
    // A card that prints no team number (prints_number false) states a
    // league-wide fact, so it may not name the team however attributable the
    // pass-rate cell happens to be. Measured: 65 of 1,034 real snaps drew the
    // chip beside a sentence no team number produced.
    st.attributed = !!(ten && ten.can_attribute && card.prints_number !== false);
    var pr = card.prime;
    var tendTpl = st.attributed ? pr.tendency : (pr.tendency_low || pr.tendency);
    var watchTpl = useShortWatch(card) ? (pr.watch_short || pr.watch) : pr.watch;
    st.sitLine = fill(pr.situation, sit, rate);
    st.tendLine = fill(tendTpl, sit, rate);
    st.watchLine = fill(watchTpl, sit, rate);

    var a = askFor(card);
    if (a && askEligible(a)) {
      st.ask = a;
      st.askAt = Date.now();
      st.sinceAsk = 0;
      st.gap = drawGap();
      st.res = null;                       // the new ask replaces the old result
      sh.diag('ask', { sit: sit.sitKey, kind: a.kind, card: card.id });
      st.pending = {
        sitKey: sit.sitKey, cardId: card.id, kind: a.kind,
        concepts: (card.concepts || []).slice(),
        explain: card.explain_hint || '',
        bucket: ten ? ten.bucket : '', game: sit.gameId || '',
        down: sit.down, distance: sit.distance, ytg: sit.yardsToGoal,
        answer: null, latency: 0
      };
    }
    sh.bumpExposure(card.concepts);
  }
  render();
  flash();
});

// ---------------------------------------------------------------- render
function flash() {
  var p = $('prime');
  p.classList.add('fresh');
  setTimeout(function () { p.classList.remove('fresh'); }, 60);
}
function quietPrime(msg) {
  $('prime').className = '';
  $('pQuiet').hidden = false;
  $('pQuiet').textContent = msg;
  document.querySelector('.pTop').hidden = true;
  $('pDD').textContent = '';
  $('pSpot').textContent = '';
  $('pSit').textContent = '';
  $('pTen').textContent = '';
  $('pWatch').textContent = '';
  $('pFoot').innerHTML = '';
  $('pDef').className = '';
  $('pDef').textContent = '';
  $('fieldPosition').hidden = true;
}

// A diagram of the same pre-snap whitelist the card reads. Offense always
// moves left to right; neither the diagram nor its labels can see a result.
function renderField(sit) {
  var ball = 30 + (100 - sit.yardsToGoal) * 4.4;
  var target = 30 + Math.min(100, 100 - sit.yardsToGoal + sit.distance) * 4.4;
  var goal = sit.distance >= sit.yardsToGoal;
  $('fieldPosition').hidden = false;
  $('ballLine').setAttribute('x1', ball);
  $('ballLine').setAttribute('x2', ball);
  $('ballMarker').setAttribute('cx', ball);
  $('firstDownLine').setAttribute('x1', target);
  $('firstDownLine').setAttribute('x2', target);
  $('fieldDirection').textContent = (sit.offenseTeam.abbreviation || '') + ' possession →';
  $('fieldTargetLabel').textContent = goal ? 'Goal line' : 'First down';
  $('fieldGraphic').setAttribute('aria-label', sit.yardsToGoal + ' yards from the end zone, ' +
    sit.distance + ' yards to ' + (goal ? 'score.' : 'a first down.') + ' Offense moves left to right.');
}
// Two signatures, two redraws, deliberately separate. The card above and the
// ask below are torn down only when their own content changed, so a poll, a
// countdown tick or a concept bump can never rebuild a tap target under a
// thumb that is already on its way down.
function cardSig() {
  return [
    st.sitKey, st.card ? st.card.id : '', st.attributed ? 1 : 0, st.rate,
    st.sitLine, st.tendLine, st.watchLine, st.quiet, st.openConcept || ''
  ].join('|');
}
function askSig() {
  return [
    st.ask ? st.ask.id : '', st.pending && st.pending.answer ? st.pending.answer : '',
    st.res ? st.res.cls + '|' + st.res.head + '|' + st.res.body + '|' + st.res.why : ''
  ].join('~');
}
function render() {
  renderAsk();
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
  $('pSpot').textContent = (sit.spotText ? 'at ' + sit.spotText + ' · ' : '') +
    sit.yardsToGoal + ' to the end zone';
  $('pHold').textContent = st.hold;

  renderField(sit);

  if (!st.card) {
    $('pSit').textContent = '';
    $('pTen').textContent = '';
    $('pWatch').textContent = '';
    $('pQuiet').hidden = false;
    $('pQuiet').textContent = 'Waiting for the next situation.';
    $('pFoot').innerHTML = '';
    $('pDef').className = '';
    $('prime').className = '';
    return;
  }

  // The down and distance already have their own heading.
  $('pSit').textContent = /^(First|Second|Third|Fourth) and \d+\.$/.test(st.sitLine) ? '' : st.sitLine;
  $('pTen').textContent = st.tendLine;
  $('pWatch').textContent = st.watchLine;
  $('prime').className = st.attributed ? '' : 'low';

  // The source chip is attribution too. It carries the team name on exactly
  // the snaps the copy is allowed to, and never on the rest.
  var chips = [];
  var ten = st.ten;
  if (st.attributed && ten) {
    chips.push('<span class="chip src">' + esc(ten.team) + ' · ' + sh.seasonsLabel() +
      ' · ' + ten.sample_size + ' plays</span>');
  } else {
    chips.push('<span class="chip srcl">All offenses · ' + sh.seasonsLabel() + '</span>');
  }
  var cs = st.card.concepts || [];
  for (var i = 0; i < cs.length; i++) {
    var s = sh.conceptState(cs[i]);
    chips.push('<button class="chip' + (s === 'familiar' ? ' known' : '') +
      '" data-c="' + esc(cs[i]) + '">' + esc(cs[i].replace(/_/g, ' ')) + '</button>');
  }
  $('pFoot').innerHTML = chips.join('');

  var def = $('pDef');
  var C = sh.cards();
  if (st.openConcept && C && C.concepts[st.openConcept] && cs.indexOf(st.openConcept) >= 0) {
    def.className = 'on';
    def.textContent = st.openConcept.replace(/_/g, ' ') + ': ' + C.concepts[st.openConcept];
  } else {
    def.className = '';
    def.textContent = '';
  }
}
function renderAsk() {
  var sig = askSig();
  if (sig === st.asig) return;
  st.asig = sig;
  var res = $('pRes'), ask = $('pAsk'), lock = $('askLock'), btns = $('askBtns');
  if (st.res) {
    res.className = 'on ' + st.res.cls;
    res.innerHTML = (st.res.head ? '<b>' + esc(st.res.head) + '</b> ' : '') + esc(st.res.body) +
      (st.res.why ? '<span class="why">' + esc(st.res.why) + '</span>' : '');
  } else {
    res.className = '';
    res.innerHTML = '';
  }
  if (st.ask && st.pending) {
    ask.className = 'on';
    $('askQ').textContent = st.ask.q;
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
$('pFoot').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-c]');
  if (!b) return;
  st.openConcept = st.openConcept === b.dataset.c ? null : b.dataset.c;
  render();
});

// ---------------------------------------------------------------- ledger view
function renderLedger() {
  var L = sh.ledger().concepts;
  var names = Object.keys(L);
  var order = { unknown: 0, introduced: 1, learning: 2, familiar: 3 };
  names.sort(function (a, b) {
    var d = order[sh.conceptState(a)] - order[sh.conceptState(b)];
    if (d) return d;
    return (L[b].exposures || 0) - (L[a].exposures || 0);
  });
  var h = '';
  for (var i = 0; i < names.length; i++) {
    var n = names[i], r = L[n], s = sh.conceptState(n);
    var score = r.attempts
      ? r.correct + ' of ' + r.attempts + ' right' +
        (r.fast_ms ? ', ' + (r.fast_ms / 1000).toFixed(1) + 's' : '')
      : 'Seen ' + (r.exposures || 0) + ' times';
    h += '<div class="lrow"><span class="nm">' + esc(n.replace(/_/g, ' ')) + '</span>' +
      '<span class="stt ' + s + '">' + ({ unknown: 'New', introduced: 'Seen', learning: 'Practicing', familiar: 'Familiar' })[s] + '</span>' +
      '<span class="sc">' + esc(score) + '</span></div>';
  }
  $('ledgerView').innerHTML = h ||
    '<div class="lrow"><span class="nm">Terms appear here as you watch.</span></div>';
  $('ledgerNote').textContent = names.length
    ? 'Your answers and the terms you have seen help decide when to shorten definitions.'
    : 'Make a few calls during a game to start your practice history.';
}
sh.bus.on('sheet', renderLedger);
sh.bus.on('reset', function () { st.sig = ''; st.asig = ''; render(); renderLedger(); });

})(shell);

// =================================================================== LIVE
// Everything ESPN. Allowed to know what happened.
(function initLive(sh) {

var st = {
  gameId: null, games: [], gameLabel: '', gameState: '',
  sum: null,                 // latest raw summary, this scope only
  seen: {}, queue: [], rows: [], shownPlay: null,
  lastQueuedSit: '', primed: false, lastOk: 0, sheet: false
};

function etDate(offsetDays) {
  var d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d).replace(/-/g, '');
}
function scoreboardUrl(lg, day) {
  return sh.API + sh.LEAGUES[lg].path + '/scoreboard?dates=' + day + '&_=' + Date.now();
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
function logoImage(url) {
  if (!url || unavailableLogos.has(url)) return '';
  return '<img class="team-logo" src="' + sh.esc(url) + '" width="32" height="32" alt="" aria-hidden="true" loading="lazy" decoding="async">';
}
document.addEventListener('error', function (event) {
  var img = event.target;
  if (img instanceof HTMLImageElement && img.classList.contains('team-logo')) {
    unavailableLogos.add(img.getAttribute('src'));
    img.hidden = true;
  }
}, true);
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
  return sh.jget(scoreboardUrl(lg, etDate(0))).then(function (sb) {
    var rows = (sb.events || []).map(eventRow);
    if (rows.some(function (r) { return r.state === 'in'; })) return rows;
    return sh.jget(scoreboardUrl(lg, etDate(-1))).then(function (sb2) {
      var y = (sb2.events || []).map(eventRow);
      var live = y.filter(function (r) { return r.state === 'in'; });
      return live.length ? live.concat(rows) : (rows.length ? rows : y);
    }).catch(function () { return rows; });
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
      var p = ps[j], id = String(p.id);
      if (seen[id] !== undefined) { out[seen[id]] = p; continue; }
      seen[id] = out.length;
      out.push(p);
    }
  }
  return out;
}
// pass / run / kick / other, matching how engine/ingest_*.py classify. A sack
// or a scramble is a pass, because the call was a pass. Kneels, spikes,
// penalties, timeouts and period markers are `other` and void any call.
function classify(p) {
  var t = ((p.type && p.type.text) || '').toLowerCase();
  var raw = (p.text || '').toLowerCase();
  if (p.isPenalty) return 'other';
  if (/\bkneel|\bspike|kneel down/.test(raw)) return 'other';
  if (t.indexOf('penalt') >= 0 || t.indexOf('timeout') >= 0 ||
      t.indexOf('end ') === 0 || t.indexOf('end of') === 0 ||
      t.indexOf('two-minute') === 0 || t.indexOf('two minute') === 0 ||
      t.indexOf('official') >= 0 || t.indexOf('coin toss') >= 0 ||
      t.indexOf('safety') === 0) return 'other';
  if (t.indexOf('kickoff') >= 0 || t.indexOf('punt') >= 0 ||
      t.indexOf('field goal') >= 0 || t.indexOf('extra point') >= 0 ||
      t.indexOf('kick') >= 0) return 'kick';
  if (t.indexOf('pass') >= 0 || t.indexOf('sack') >= 0 ||
      t.indexOf('interception') >= 0 || t.indexOf('scramble') >= 0) return 'pass';
  if (t.indexOf('rush') >= 0 || t.indexOf('run') >= 0) return 'run';
  // A fumble is typed by its recovery, not by the play that lost the ball.
  if (t.indexOf('fumble') >= 0) {
    if (/\bpass\b|\bsack/.test(raw)) return 'pass';
    if (/\brush\b|\brun\b/.test(raw)) return 'run';
    return 'other';
  }
  return 'other';
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
function gainPhrase(y, need, down) {
  var s = y > 0 ? 'Gained ' + y + ' yard' + (y === 1 ? '' : 's') + '.'
    : y < 0 ? 'Lost ' + (-y) + ' yard' + (y === -1 ? '' : 's') + '.' : 'No gain.';
  if (typeof need !== 'number' || !down) return s;
  if (y >= need) return s + ' First down.';
  if (down >= 4) return s;
  return s + ' ' + (need - y) + ' short of the marker.';
}
// Deterministic. No generation, no model.
function plainPlay(p) {
  var t = ((p.type && p.type.text) || '').toLowerCase();
  var raw = p.text || '';
  var y = typeof p.statYardage === 'number' ? p.statYardage : null;
  var start = p.start || {};
  var need = typeof start.distance === 'number' ? start.distance : null;
  var down = start.down;
  var g = y === null ? '' : gainPhrase(y, need, down);

  if (/kneel down|\bkneels\b/i.test(raw)) return { s: 'Took a knee to run down the clock.', k: '' };
  if (t === 'rush') return { s: 'Run. ' + g, k: '' };
  if (t === 'rushing touchdown') return { s: 'Run for a touchdown. Six points.', k: 'score' };
  if (t === 'passing touchdown') return { s: 'Touchdown pass. Six points.', k: 'score' };
  if (t === 'pass reception') return { s: 'Pass complete. ' + g, k: '' };
  if (t === 'pass incompletion') return { s: 'Incomplete pass. No gain; the clock stops.', k: '' };
  if (t === 'sack') {
    return { s: 'The defense tackled the quarterback before he could throw' +
      (y !== null && y < 0 ? ', ' + (-y) + ' yards back.' : '.'), k: '' };
  }
  if (t.indexOf('interception') >= 0 && t.indexOf('touchdown') >= 0) {
    return { s: 'Interception returned for a touchdown. Six points for the defense.', k: 'score' };
  }
  if (t.indexOf('interception') >= 0) return { s: 'Interception. A defender caught the pass, so possession changes.', k: 'turn' };
  if (t === 'fumble recovery (opponent)') return { s: 'The ball came loose and the other team fell on it.', k: 'turn' };
  if (t === 'fumble recovery (own)') return { s: 'The ball came loose and they got it back.', k: '' };
  if (t === 'punt' || t === 'punt return') return { s: 'Punt. Kicked the ball downfield to the other team.', k: '' };
  if (t === 'field goal good') return { s: 'Field goal good. Three points.', k: 'score' };
  if (t === 'field goal missed') return { s: 'Field goal missed. No points.', k: 'turn' };
  if (t === 'blocked field goal') return { s: 'Field goal blocked. No points from the kick.', k: 'turn' };
  if (t === 'kickoff' || t === 'kickoff return (offense)') return { s: 'Kickoff. New drive starting.', k: '' };
  if (t === 'safety') return { s: 'Safety. Two points to the defense.', k: 'score' };
  if (t === 'penalty') return { s: 'Penalty. The ball moves and the down may be replayed.', k: '' };
  if (t === 'timeout') return { s: 'Timeout.', k: '' };
  if (t.indexOf('end ') === 0 || t.indexOf('end of') === 0) return { s: raw || 'Period over.', k: '' };
  if (t.indexOf('two-minute') === 0 || t.indexOf('two minute') === 0) return { s: 'Two-minute timeout.', k: '' };
  return { s: (p.type && p.type.text) || 'Play.', k: '' };
}
function teamAbbrs(sum) {
  var comp = sum && sum.header && sum.header.competitions && sum.header.competitions[0];
  var by = {}, cs = (comp && comp.competitors) || [];
  for (var i = 0; i < cs.length; i++) {
    if (cs[i].team) by[String(cs[i].team.id)] = cs[i].team.abbreviation || cs[i].team.shortDisplayName || '';
  }
  return by;
}
function feedRow(p, abbr) {
  var s = p.start || {};
  var pl = plainPlay(p);
  return {
    id: String(p.id),
    dd: s.downDistanceText || '',
    off: s.team && s.team.id ? (abbr[String(s.team.id)] || '') : '',
    when: (p.period && p.period.number ? 'Q' + p.period.number + ' ' : '') +
          ((p.clock && p.clock.displayValue) || ''),
    plain: pl.s, kind: pl.k, raw: p.text || '',
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
function preSnap(sum, plays) {
  var comp = sum && sum.header && sum.header.competitions && sum.header.competitions[0];
  if (!comp) return null;
  var status = comp.status;
  if (!status || !status.type || status.type.state !== 'in') return null;
  if (status.type.name === 'STATUS_HALFTIME') return null;

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
  var clock = clockToSeconds(status.displayClock);
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

  var os = Number(off.score || 0), ds = Number(def.score || 0);
  return Object.freeze({
    down: fx.down,
    distance: fx.distance,
    yardsToGoal: fx.yardsToGoal,
    period: period,
    clockSeconds: clock,
    offenseScore: os,
    defenseScore: ds,
    scoreDiff: os - ds,
    offenseTeam: trimTeam(off.team),
    defenseTeam: trimTeam(def.team),
    spotText: end.possessionText || '',
    ddText: end.shortDownDistanceText || '',
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
function due(item) { return item.at === 0 ? 0 : item.at + sh.delayMs(); }
function pump() {
  var now = Date.now(), moved = false;
  while (st.queue.length && due(st.queue[0]) <= now) {
    var it = st.queue.shift();
    moved = true;
    if (it.kind === 'play') {
      st.rows.unshift(it.row);
      if (st.rows.length > sh.FEED_MAX) st.rows.length = sh.FEED_MAX;
      st.shownPlay = it.row;
      if (!it.silent && !it.marker) {
        sh.bus.emit('result', {
          sitKey: it.sitKey, kind: it.cls,
          gained: it.gained, need: it.need
        });
      }
    } else if (it.kind === 'snap') {
      sh.diag('snap', it.sit.sitKey);
      sh.bus.emit('snap', it.sit);
    } else if (it.kind === 'nosnap') {
      sh.diag('nosnap', it.msg);
      sh.bus.emit('nosnap', it.msg);
    }
  }
  if (moved) { renderFeed(); renderHeader(); }
  // countdown for whatever is still waiting
  var head = st.queue.length ? Math.ceil((due(st.queue[0]) - now) / 1000) : 0;
  sh.bus.emit('hold', head > 0 ? head : 0);
}

function applySummary(sum) {
  st.sum = sum;
  var comp = sum && sum.header && sum.header.competitions && sum.header.competitions[0];
  var status = comp && comp.status;
  st.gameState = (status && status.type && status.type.state) || '';
  st.statusName = (status && status.type && status.type.name) || '';

  var plays = collectPlays(sum);
  var abbr = teamAbbrs(sum);
  var first = !st.primed;
  var now = Date.now();
  var last = plays.length - 1;

  // On the first poll of a game the backlog is history he has already watched,
  // so it goes up at once. The exception is the play at the end of it: on his
  // TV that one is probably still in the air, so it waits the full delay like
  // every play after it. Failing late is invisible, failing early ruins it.
  var startAt = first ? Math.max(0, plays.length - sh.FEED_MAX) : 0;
  for (var i = startAt; i < plays.length; i++) {
    var p = plays[i], id = String(p.id);
    if (st.seen[id]) continue;
    st.seen[id] = 1;
    var backlog = first && i < last;
    st.queue.push({
      kind: 'play', at: backlog ? 0 : now, silent: backlog, marker: isMarker(p),
      row: feedRow(p, abbr),
      cls: classify(p),
      sitKey: playSitKey(p, abbr),
      gained: typeof p.statYardage === 'number' ? p.statYardage : null,
      need: typeof (p.start || {}).distance === 'number' ? p.start.distance : null
    });
  }
  // plays already seen but not yet released stay queued; mark the rest seen so
  // a first-poll backlog older than FEED_MAX never appears later
  for (var k = 0; k < startAt; k++) st.seen[String(plays[k].id)] = 1;

  var sit = preSnap(sum, plays);
  sh.diag('poll', {
    plays: plays.length, q: st.queue.length,
    last: plays.length ? ((plays[plays.length - 1].type || {}).text || '') : '',
    sit: sit ? sit.sitKey : null, status: st.statusName,
    clock: status ? status.displayClock : null, period: status ? status.period : null
  });
  if (sit) {
    if (sit.sitKey !== st.lastQueuedSit) {
      st.lastQueuedSit = sit.sitKey;
      st.queue.push({ kind: 'snap', at: now, sit: sit });
    }
  } else if (st.lastQueuedSit !== '') {
    // the drive ended: touchdown, made kick, end of period. Take the card down
    // on the same delay, so it does not vanish before he has seen the play.
    st.lastQueuedSit = '';
    st.queue.push({ kind: 'nosnap', at: now, msg: waitingMessage() });
  } else {
    sh.bus.emit('quiet', waitingMessage());
  }
  st.primed = true;

  pump();
  renderHeader();
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
    $('score').textContent = st.gameId ? 'Loading game…' : 'Choose a game';
    $('hmeta').textContent = '';
  } else {
    var cs = comp.competitors || [];
    var h = null, a = null;
    for (var i = 0; i < cs.length; i++) { if (cs[i].homeAway === 'home') h = cs[i]; else a = cs[i]; }
    var an = a && a.team ? (a.team.abbreviation || a.team.shortDisplayName) : '?';
    var hn = h && h.team ? (h.team.abbreviation || h.team.shortDisplayName) : '?';
    // With a delay set, the score bug would otherwise spoil a touchdown he has
    // not watched yet. Show the game as of the last play released to him.
    var held = sh.delayMs() > 0 && st.shownPlay && st.shownPlay.awayScore !== null;
    var as = held ? st.shownPlay.awayScore : (a ? a.score : '');
    var hs = held ? st.shownPlay.homeScore : (h ? h.score : '');
    $('score').innerHTML = '<span class="score-team">' + logoImage(teamLogo(a && a.team)) + '<span class="team-abbr">' + sh.esc(an) +
      '</span><span class="team-score">' + sh.esc(as) + '</span></span>' +
      '<span class="sep">AT</span><span class="score-team">' + logoImage(teamLogo(h && h.team)) + '<span class="team-abbr">' +
      sh.esc(hn) + '</span><span class="team-score">' + sh.esc(hs) + '</span></span>';
    var status = comp.status || {};
    var detail = held
      ? (st.shownPlay.period ? 'Q' + st.shownPlay.period + ' ' + st.shownPlay.clock : '')
      : ((status.type && (status.type.shortDetail || status.type.detail)) || '');
    $('hmeta').textContent = detail;
    st.gameLabel = an + ' at ' + hn;
  }
  paintConnection();
}
function paintConnection() {
  var fresh = Date.now() - st.lastOk < sh.STALE_MS;
  $('dot').className = 'dot' + (fresh ? ' ok' : '');
  $('connectionLabel').textContent = fresh ? 'Connected' : st.gameId ? 'Connecting' : 'No game';
}
function renderFeed() {
  var el = $('feed');
  if (!st.rows.length) {
    el.innerHTML = '<div class="empty">Waiting for the first play.</div>';
    return;
  }
  var expanded = {};
  el.querySelectorAll('details[open]').forEach(function (details) { expanded[details.dataset.play] = true; });
  var h = '';
  for (var i = 0; i < st.rows.length; i++) {
    var r = st.rows[i];
    h += '<div class="play">' +
      '<div class="pl1">' + (r.off ? '<b>' + sh.esc(r.off) + '</b>' : '') +
      '<span>' + sh.esc(r.dd) + '</span>' +
      '<span class="t num">' + sh.esc(r.when) + '</span></div>' +
      '<div class="pl2 ' + r.kind + '">' + sh.esc(r.plain) + '</div>' +
      (r.raw ? '<details class="play-details" data-play="' + sh.esc(r.id) + '"' +
        (expanded[r.id] ? ' open' : '') + '><summary>Play details</summary><p class="pl3">' +
        sh.esc(r.raw) + '</p></details>' : '') +
      '</div>';
  }
  el.innerHTML = h;
}
function renderPicker() {
  $('pickBtn').dataset.gameLabel = st.gameLabel;
  $('pickBtn').setAttribute('aria-label', st.gameLabel ? 'Change game, currently ' + st.gameLabel : 'Choose a game');

  var segs = document.querySelectorAll('.seg button');
  for (var i = 0; i < segs.length; i++) {
    segs[i].className = segs[i].dataset.lg === sh.league() ? 'on' : '';
    segs[i].setAttribute('aria-pressed', String(segs[i].dataset.lg === sh.league()));
  }
  var groups = [
    ['Live now', st.games.filter(function (g) { return g.state === 'in'; })],
    ['Coming up', st.games.filter(function (g) { return g.state === 'pre'; })],
    ['Final', st.games.filter(function (g) { return g.state === 'post'; })]
  ];
  var h = '';
  for (var gi = 0; gi < groups.length; gi++) {
    var rows = groups[gi][1];
    if (!rows.length) continue;
    h += '<div class="grouphead">' + groups[gi][0] + '</div>';
    for (var j = 0; j < rows.length; j++) {
      var g = rows[j];
      var sub = g.state === 'pre' ? g.detail
        : g.away + ' ' + g.awayScore + '  ·  ' + g.home + ' ' + g.homeScore + '  ·  ' + g.detail;
      h += '<button class="gbtn' + (g.id === st.gameId ? ' sel' : '') + '" data-g="' + sh.esc(g.id) + '">' +
        '<span class="game-teams"><span class="game-team">' + logoImage(g.awayLogo) + '<b>' + sh.esc(g.away) +
        '</b></span><span class="game-versus">at</span><span class="game-team">' + logoImage(g.homeLogo) + '<b>' + sh.esc(g.home) +
        '</b></span></span><small>' + sh.esc(sub) + '</small></button>';
    }
  }
  $('games').innerHTML = h || '<div class="empty">No games on the schedule today.</div>';
}

// ---------------------------------------------------------------- loop
var pollTimer = null, sbTimer = null;
function pollGame() {
  clearTimeout(pollTimer);
  if (!st.gameId) { pollTimer = setTimeout(pollGame, sh.POLL_MS); return; }
  var t0 = Date.now();
  sh.jget(summaryUrl(sh.league(), st.gameId)).then(function (sum) {
    st.lastOk = Date.now();
    sh.showErr('');
    applySummary(sum);
  }).catch(function (e) {
    sh.diag('err', { where: 'feed', msg: e.message, ms: Date.now() - t0 });
    sh.showErr('Game feed unavailable. Retrying…');
    $('dot').className = 'dot';
  }).then(function () {
    pollTimer = setTimeout(pollGame, sh.POLL_MS);
  });
}
function pollScoreboard(force) {
  clearTimeout(sbTimer);
  if (!(force || st.sheet || !st.gameId)) {
    sbTimer = setTimeout(function () { pollScoreboard(false); }, sh.SB_MS);
    return;
  }
  fetchGames(sh.league()).then(function (rows) {
    st.games = rows;
    if (!st.gameId) {
      var live = rows.filter(function (g) { return g.state === 'in'; });
      if (live.length) selectGame(live[0].id);
    }
    renderPicker();
  }).catch(function (e) {
    sh.showErr('Games could not be updated. Retrying…');
  }).then(function () {
    sbTimer = setTimeout(function () { pollScoreboard(false); }, sh.SB_MS);
  });
}
function resetGame() {
  st.sum = null; st.seen = {}; st.queue = []; st.rows = [];
  st.shownPlay = null; st.lastQueuedSit = ''; st.primed = false;
  sh.bus.emit('clear');
}
function selectGame(id) {
  st.gameId = String(id);
  sh.diag('game', { id: st.gameId, league: sh.league() });
  resetGame();
  sh.lsSet(sh.LS.game + sh.league(), st.gameId);
  var g = st.games.filter(function (x) { return x.id === st.gameId; })[0];
  if (g) st.gameLabel = g.name;
  renderPicker();
  sh.bus.emit('quiet', waitingMessage());
  renderFeed();
  pollGame();
}

// ---------------------------------------------------------------- wiring
$('pickBtn').addEventListener('click', function () {
  st.sheet = true;
  $('sheet').className = 'sheet on';
  renderPicker();
  sh.bus.emit('sheet');
  pollScoreboard(true);
});
function closeSheet() { st.sheet = false; $('sheet').className = 'sheet'; }
$('closeSheet').addEventListener('click', closeSheet);
$('sheet').addEventListener('click', function (ev) { if (ev.target === $('sheet')) closeSheet(); });
$('games').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-g]');
  if (!b) return;
  selectGame(b.dataset.g);
  closeSheet();
});
sh.bus.on('leagueChanged', function () {
  st.gameId = null; st.games = []; st.gameLabel = '';
  resetGame();
  renderPicker(); renderFeed();
  var saved = sh.lsGet(sh.LS.game + sh.league());
  fetchGames(sh.league()).then(function (rows) {
    st.games = rows;
    var pick = rows.filter(function (g) { return g.id === saved && g.state !== 'post'; })[0] ||
               rows.filter(function (g) { return g.state === 'in'; })[0];
    renderPicker();
    if (pick) selectGame(pick.id);
    else sh.bus.emit('quiet', 'No live games. Open Games to see the schedule.');
  }).catch(function (e) { sh.showErr('Games could not be loaded. Open Games to try again.'); });
});
sh.bus.on('delay', function () { pump(); renderHeader(); });

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') pollGame();
});
setInterval(pump, sh.TICK_MS);
setInterval(paintConnection, 1000);

sh.bus.on('boot', function () {
  renderPicker();
  var saved = sh.lsGet(sh.LS.game + sh.league());
  fetchGames(sh.league()).then(function (rows) {
    st.games = rows;
    var pick = rows.filter(function (g) { return g.id === saved && g.state !== 'post'; })[0] ||
               rows.filter(function (g) { return g.state === 'in'; })[0];
    renderPicker();
    if (pick) selectGame(pick.id);
    else sh.bus.emit('quiet', 'No live games. Open Games to see the schedule.');
  }).catch(function (e) {
    sh.showErr('Games could not be loaded. Open Games to try again.');
  }).then(function () {
    pollGame();
    pollScoreboard(false);
  });
});

})(shell);

// ================================================================= shell wiring
function paintDelay() {
  $('dVal').textContent = delaySec + 's';
  $('dSlide').value = String(delaySec);
  $('delayBtn').textContent = 'TV +' + delaySec + 's';
  $('delayBtn').className = delaySec > 0 ? 'on' : '';
  $('dNote').textContent = delaySec === 0
    ? 'No delay. Updates appear as they arrive.'
    : 'Updates wait ' + delaySec + ' second' + (delaySec === 1 ? '' : 's') + '.';
}
function setDelay(n) {
  n = Math.max(0, Math.min(MAX_DELAY, Math.round(n)));
  if (n === delaySec) return;
  delaySec = n;
  lsSet(LS.delay, String(n));
  paintDelay();
  bus.emit('delay', n);
}
$('delayBtn').addEventListener('click', function () { $('dsheet').className = 'sheet on'; });
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
      navigator.share({ title: 'Football Companion diagnostics', text: text })
        .then(function () { done('Shared.'); }).catch(function () { done('Could not copy.'); });
    } else done('Could not copy.');
  });
});
$('buildNote').textContent = 'build ' + VERSION;
document.querySelector('.seg').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-lg]');
  if (!b || b.dataset.lg === league) return;
  league = b.dataset.lg;
  lsSet(LS.league, league);
  TEND = null;
  bus.emit('tables');
  loadTables().then(function () {
    bus.emit('tables');
    bus.emit('leagueChanged', league);
  }).catch(function (e) { showErr('Football stats could not be loaded. Refresh to try again.'); });
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
  return jget(LEAGUES[league].table).then(function (t) { TEND = t; });
}

loadLedger();
loadAsks();
loadDiag();
diag('boot', { version: VERSION, league: league, delay: delaySec });
paintDelay();

Promise.all([
  jget('cards.json').then(function (c) { CARDS = c; }),
  loadTables()
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

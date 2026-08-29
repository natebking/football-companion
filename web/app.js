'use strict';
/*
 * Football Companion, live page.
 *
 * Two data paths, kept physically apart:
 *
 *   PRIME PATH   summary -> readSituation() -> tendency lookup -> card
 *                readSituation() is a whitelist. It copies a fixed list of
 *                pre-snap fields and nothing else, so no play result can
 *                reach the card pipeline. CONTRACT.md, "Prime cards receive
 *                pre-snap information only."
 *
 *   FEED PATH    summary -> plays -> plain language rows
 *                This path is allowed to know what happened. It never calls
 *                anything the prime path calls.
 *
 * No backend. The browser talks to ESPN directly (ESPN 403s datacenter IPs
 * but serves access-control-allow-origin: *). No LLM calls anywhere.
 */
(function () {

// ------------------------------------------------------------------ config
var POLL_MS = 3000;          // selected game, summary endpoint
var SB_MS = 12000;           // scoreboard, only while picking a game
var STALE_MS = 9000;         // live dot goes red after this
var FEED_MAX = 25;

var LEAGUES = {
  cfb: { path: 'college-football', label: 'College', table: 'tendency-cfb.json' },
  nfl: { path: 'nfl', label: 'NFL', table: 'tendency-nfl.json' }
};
var API = 'https://site.api.espn.com/apis/site/v2/sports/football/';

// nflverse abbreviations the tendency tables use, where ESPN differs
var NFL_ALIAS = { LAR: 'LA', WSH: 'WAS', JAC: 'JAX', SD: 'LAC', OAK: 'LV', STL: 'LA' };

var LS = { league: 'fc_league', game: 'fc_game_', ledger: 'fc_ledger' };

// ------------------------------------------------------------------ state
var state = {
  league: 'cfb',
  gameId: null,
  games: [],
  gameLabel: '',
  gameState: '',    // 'pre' | 'in' | 'post', from the summary header
  sit: null,          // frozen pre-snap situation, or null
  sitKey: '',
  card: null,
  feed: [],
  lastOk: 0,
  err: '',
  sheet: false,
  openConcept: null
};
var TEND = null;        // tendency table for state.league
var NAMEIX = null;      // normalised team name -> tendency key
var CARDS = null;       // cards.json
var ledger = { concepts: {} };

var $ = function (id) { return document.getElementById(id); };

// ------------------------------------------------------------------ storage
function loadLedger() {
  try {
    var raw = localStorage.getItem(LS.ledger);
    if (raw) {
      var d = JSON.parse(raw);
      if (d && d.concepts) ledger = d;
    }
  } catch (e) { ledger = { concepts: {} }; }
}
function saveLedger() {
  try { localStorage.setItem(LS.ledger, JSON.stringify(ledger)); } catch (e) {}
}
function conceptState(n) {
  if (n >= 5) return 'familiar';
  if (n >= 2) return 'learning';
  if (n >= 1) return 'introduced';
  return 'unknown';
}
function exposures(c) {
  var e = ledger.concepts[c];
  return e && typeof e.exposures === 'number' ? e.exposures : 0;
}
function bumpConcepts(list) {
  if (!list || !list.length) return;
  var now = new Date().toISOString();
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    var n = exposures(c) + 1;
    ledger.concepts[c] = { exposures: n, last_seen: now, state: conceptState(n) };
  }
  saveLedger();
}

// ------------------------------------------------------------------ buckets
// mirrors engine/buckets.py, per CONTRACT.md
function distanceBand(d) { return d <= 3 ? 'short' : d <= 7 ? 'medium' : 'long'; }
function fieldZone(y) {
  return y >= 80 ? 'own_deep' : y >= 60 ? 'own' : y >= 40 ? 'mid' : y >= 20 ? 'opp' : 'red';
}
function bucketKey(down, dist, ytg) {
  return 'd' + down + '_' + distanceBand(dist) + '_' + fieldZone(ytg);
}

// ------------------------------------------------------------------ teams
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
  if (!TEND) return;
  for (var k in TEND.teams) {
    var n = normName(k);
    if (!(n in NAMEIX)) NAMEIX[n] = k;
  }
}
// team: the trimmed team descriptor from readSituation
function resolveTeam(team) {
  if (!TEND || !team) return null;
  if (state.league === 'nfl') {
    var a = (team.abbreviation || '').toUpperCase();
    var k = NFL_ALIAS[a] || a;
    return TEND.teams[k] ? k : null;
  }
  var cands = [team.location, team.shortDisplayName, team.displayName, team.name];
  for (var i = 0; i < cands.length; i++) {
    var hit = NAMEIX[normName(cands[i])];
    if (hit) return hit;
  }
  return null;
}

// ------------------------------------------------------------------ tendency
// Client port of the reference lookup() in engine/export_tables.py.
// Three states: team entry (rung 1 or 2, high, attribute), league baseline
// (rung 5, low, never attribute), nothing at all (say nothing).
function lookupTendency(teamKey, down, dist, ytg) {
  if (!TEND) return null;
  var key = bucketKey(down, dist, ytg);
  var base = TEND.league_baseline[key] || null;
  var te = teamKey && TEND.teams[teamKey] ? TEND.teams[teamKey][key] : null;
  if (te) {
    return {
      bucket: key, team: teamKey, rung: te.rung, confidence: 'high',
      sample_size: te.sample_size, pass_rate: te.pass_rate,
      league_pass_rate: base ? base.pass_rate : null,
      success_rate: null, explosive_rate: null
    };
  }
  if (base) {
    return {
      bucket: key, team: null, rung: 5, confidence: 'low',
      sample_size: base.sample_size, pass_rate: base.pass_rate,
      league_pass_rate: base.pass_rate,
      success_rate: base.success_rate, explosive_rate: base.explosive_rate
    };
  }
  return null;
}

// ------------------------------------------------------------------ cards
function cardApplies(c, sit, ten) {
  var a = c.applies || {};
  if (a.down && a.down.indexOf(sit.down) < 0) return false;
  if (a.distance_band && a.distance_band.indexOf(distanceBand(sit.distance)) < 0) return false;
  if (a.field_zone && a.field_zone.indexOf(fieldZone(sit.yardsToGoal)) < 0) return false;
  if (typeof a.min_yards_to_goal === 'number' && sit.yardsToGoal < a.min_yards_to_goal) return false;
  if (typeof a.max_yards_to_goal === 'number' && sit.yardsToGoal > a.max_yards_to_goal) return false;
  if (a.period && a.period.indexOf(sit.period) < 0) return false;
  if (typeof a.max_clock_seconds === 'number') {
    if (sit.clockSeconds === null || sit.clockSeconds > a.max_clock_seconds) return false;
  }
  if (typeof a.min_score_diff === 'number' && sit.scoreDiff < a.min_score_diff) return false;
  if (typeof a.max_score_diff === 'number' && sit.scoreDiff > a.max_score_diff) return false;
  if (typeof a.min_pass_rate === 'number') {
    if (!ten || ten.pass_rate === null) return false;
    if (ten.pass_rate < a.min_pass_rate) return false;
  }
  if (typeof a.max_pass_rate === 'number') {
    if (!ten || ten.pass_rate === null) return false;
    if (ten.pass_rate > a.max_pass_rate) return false;
  }
  return true;
}
function pickCard(sit, ten) {
  if (!CARDS) return null;
  var best = null;
  for (var i = 0; i < CARDS.cards.length; i++) {
    var c = CARDS.cards[i];
    if (!cardApplies(c, sit, ten)) continue;
    if (!best || (c.priority || 0) > (best.priority || 0)) best = c;
  }
  return best;
}
function fill(tpl, sit, ten) {
  return (tpl || '')
    .replace(/\{distance\}/g, String(sit.distance))
    .replace(/\{yards_to_goal\}/g, String(sit.yardsToGoal))
    .replace(/\{lead\}/g, String(Math.abs(sit.scoreDiff)))
    .replace(/\{pass_rate\}/g, ten && ten.pass_rate !== null ? String(Math.round(100 * ten.pass_rate)) : '?')
    .replace(/\{run_rate\}/g, ten && ten.pass_rate !== null ? String(Math.round(100 * (1 - ten.pass_rate))) : '?');
}
// Contract: definitions drop once every concept on the card reaches learning.
// Read the ledger before this exposure is counted, so the definition is shown
// on the first two sightings and dropped from the third.
function useShortWatch(card) {
  var cs = card.concepts || [];
  if (!cs.length) return false;
  for (var i = 0; i < cs.length; i++) {
    if (exposures(cs[i]) < 2) return false;
  }
  return true;
}

// ------------------------------------------------------------------ ESPN feed
function jget(url) {
  return fetch(url, { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}
function etDate(offsetDays) {
  var d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  var p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
  return p.replace(/-/g, '');
}
function scoreboardUrl(lg, day) {
  return API + LEAGUES[lg].path + '/scoreboard?dates=' + day + '&_=' + Date.now();
}
function summaryUrl(lg, id) {
  return API + LEAGUES[lg].path + '/summary?event=' + id + '&_=' + Date.now();
}
function eventRow(e) {
  var c = (e.competitions && e.competitions[0]) || {};
  var cs = c.competitors || [];
  var h = null, a = null;
  for (var i = 0; i < cs.length; i++) {
    if (cs[i].homeAway === 'home') h = cs[i]; else a = cs[i];
  }
  var st = (e.status && e.status.type) || {};
  return {
    id: String(e.id),
    name: e.shortName || e.name || '?',
    state: st.state || '?',
    detail: st.detail || st.shortDetail || '',
    away: a && a.team ? (a.team.shortDisplayName || a.team.abbreviation || '') : '',
    home: h && h.team ? (h.team.shortDisplayName || h.team.abbreviation || '') : '',
    awayScore: a ? Number(a.score || 0) : 0,
    homeScore: h ? Number(h.score || 0) : 0
  };
}
function fetchGames(lg) {
  return jget(scoreboardUrl(lg, etDate(0)))
    .then(function (sb) {
      var rows = (sb.events || []).map(eventRow);
      var anyLive = rows.some(function (r) { return r.state === 'in'; });
      if (anyLive || rows.length) return rows;
      // very late night: today in ET may be empty while last night runs on
      return jget(scoreboardUrl(lg, etDate(-1))).then(function (sb2) {
        return (sb2.events || []).map(eventRow);
      });
    });
}

// ================================================================
// PRIME PATH BOUNDARY
//
// Everything below this comment until the marked end reads ESPN data.
// readSituation copies an explicit list of pre-snap keys into a frozen
// object and returns it. No play text, yards gained, scoring flag or
// turnover flag is ever copied, so the prime pipeline has no result
// available to leak, and needs no filter of its own.
// ================================================================
function clockToSeconds(s) {
  if (!s) return null;
  var m = /^(\d+):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function trimTeam(t) {
  if (!t) return null;
  return {
    id: String(t.id || ''),
    abbreviation: t.abbreviation || '',
    location: t.location || '',
    shortDisplayName: t.shortDisplayName || '',
    displayName: t.displayName || '',
    name: t.name || ''
  };
}
// plays: the ordered play list. Only the `end` position block of the LAST
// play is read, and only when it describes a legal upcoming snap.
//
// Reading strictly the last play matters. ESPN writes `down: -1` on the `end`
// of a play that ended the drive (made field goal, touchdown, end of period).
// Walking backwards past one of those finds the situation of a snap that has
// already happened, and the card would prime him for a play he just watched.
// When the last play has no legal next snap the honest answer is no card;
// the following kickoff supplies the real one a few seconds later.
function readSituation(sum, plays) {
  var comp = sum && sum.header && sum.header.competitions && sum.header.competitions[0];
  if (!comp) return null;
  var st = comp.status;
  if (!st || !st.type || st.type.state !== 'in') return null;
  if (!plays.length) return null;

  var end = plays[plays.length - 1].end;
  if (!end) return null;
  if (!(end.down >= 1 && end.down <= 4)) return null;
  if (typeof end.distance !== 'number') return null;
  if (typeof end.yardsToEndzone !== 'number' || end.yardsToEndzone < 1 || end.yardsToEndzone > 99) return null;
  if (!end.team || !end.team.id) return null;

  var offId = String(end.team.id);
  var cs = comp.competitors || [];
  var off = null, def = null;
  for (var j = 0; j < cs.length; j++) {
    if (String(cs[j].team && cs[j].team.id) === offId) off = cs[j]; else def = cs[j];
  }
  if (!off || !def) return null;

  var os = Number(off.score || 0), ds = Number(def.score || 0);
  return Object.freeze({
    down: end.down,
    distance: Math.max(1, end.distance),
    yardsToGoal: end.yardsToEndzone,
    period: Number(st.period || 0),
    clockSeconds: clockToSeconds(st.displayClock),
    offenseScore: os,
    defenseScore: ds,
    scoreDiff: os - ds,
    offenseTeam: trimTeam(off.team),
    defenseTeam: trimTeam(def.team),
    spotText: end.possessionText || '',
    ddText: end.shortDownDistanceText || ''
  });
}
// ================================================================
// END PRIME PATH BOUNDARY
// ================================================================

// ------------------------------------------------------------------ feed path
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
function gainPhrase(y, need, down) {
  var s = y > 0 ? 'Gained ' + y + '.' : y < 0 ? 'Lost ' + (-y) + '.' : 'No gain.';
  if (typeof need !== 'number' || !down) return s;
  if (y >= need) return s + ' First down.';
  if (down >= 4) return s;
  return s + ' ' + (need - y) + ' short of the marker.';
}
// Deterministic. No generation, no model, no outcome hidden from him.
function plainPlay(p) {
  var t = ((p.type && p.type.text) || '').toLowerCase();
  var raw = p.text || '';
  var y = typeof p.statYardage === 'number' ? p.statYardage : null;
  var start = p.start || {};
  var need = typeof start.distance === 'number' ? start.distance : null;
  var down = start.down;
  var g = y === null ? '' : gainPhrase(y, need, down);

  if (t === 'rush') return { s: 'Ran the ball. ' + g, k: '' };
  if (t === 'rushing touchdown') return { s: 'Ran it in. Touchdown, six points.', k: 'score' };
  if (t === 'passing touchdown') return { s: 'Threw it, caught in the end zone. Touchdown, six points.', k: 'score' };
  if (t === 'pass reception') return { s: 'Threw it, caught. ' + g, k: '' };
  if (t === 'pass incompletion') return { s: 'Threw it, nobody caught it. No gain, and the clock stops.', k: '' };
  if (t === 'sack') {
    return { s: 'The defense tackled the quarterback before he could throw' +
      (y !== null && y < 0 ? ', ' + (-y) + ' yards back.' : '.'), k: '' };
  }
  if (t.indexOf('interception') === 0) return { s: 'Threw it, a defender caught it. The other team has the ball now.', k: 'turn' };
  if (t === 'fumble recovery (opponent)') return { s: 'The ball came loose and the other team fell on it.', k: 'turn' };
  if (t === 'fumble recovery (own)') return { s: 'The ball came loose and they got it back.', k: '' };
  if (t === 'punt' || t === 'punt return') return { s: 'Gave the ball away on a kick rather than risk a fourth down.', k: '' };
  if (t === 'field goal good') return { s: 'Kicked it through the uprights. Three points.', k: 'score' };
  if (t === 'field goal missed' || t === 'blocked field goal') return { s: 'The kick missed. The other team takes over.', k: 'turn' };
  if (t === 'kickoff' || t === 'kickoff return (offense)') return { s: 'Kickoff. New drive starting.', k: '' };
  if (t === 'safety') return { s: 'Tackled in their own end zone. Two points to the defense.', k: 'score' };
  if (t === 'penalty') return { s: 'Penalty. The ball moves and the down may be replayed.', k: '' };
  if (t === 'timeout') return { s: 'Timeout.', k: '' };
  if (t.indexOf('end ') === 0 || t.indexOf('end of') === 0) return { s: raw || 'Period over.', k: '' };
  if (t.indexOf('two-minute') === 0 || t.indexOf('two minute') === 0) return { s: 'Two minute warning.', k: '' };
  return { s: (p.type && p.type.text) || 'Play.', k: '' };
}
function buildFeed(sum, plays) {
  var comp = sum && sum.header && sum.header.competitions && sum.header.competitions[0];
  var byId = {};
  var cs = (comp && comp.competitors) || [];
  for (var i = 0; i < cs.length; i++) {
    if (cs[i].team) byId[String(cs[i].team.id)] = cs[i].team.abbreviation || cs[i].team.shortDisplayName || '';
  }
  var rows = [];
  var take = plays.slice(-FEED_MAX);
  for (var j = take.length - 1; j >= 0; j--) {
    var p = take[j];
    var st = p.start || {};
    var off = st.team && st.team.id ? byId[String(st.team.id)] : '';
    var pl = plainPlay(p);
    rows.push({
      id: String(p.id),
      dd: st.downDistanceText || '',
      off: off,
      when: (p.period && p.period.number ? 'Q' + p.period.number + ' ' : '') + ((p.clock && p.clock.displayValue) || ''),
      plain: pl.s,
      kind: pl.k,
      raw: p.text || ''
    });
  }
  return rows;
}

// ------------------------------------------------------------------ render
function seasonsLabel() {
  var s = (TEND && TEND.seasons) || [];
  if (!s.length) return '';
  return s.length === 1 ? String(s[0]) : s[0] + '–' + s[s.length - 1];
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function showErr(m) {
  state.err = m || '';
  var el = $('err');
  el.className = m ? 'on' : '';
  el.textContent = m || '';
}
function renderHeader(sum) {
  var comp = sum && sum.header && sum.header.competitions && sum.header.competitions[0];
  if (!comp) {
    $('score').textContent = state.gameId ? 'loading game…' : 'No game selected';
    $('hmeta').textContent = '';
  } else {
    var cs = comp.competitors || [];
    var h = null, a = null;
    for (var i = 0; i < cs.length; i++) { if (cs[i].homeAway === 'home') h = cs[i]; else a = cs[i]; }
    var an = a && a.team ? (a.team.abbreviation || a.team.shortDisplayName) : '?';
    var hn = h && h.team ? (h.team.abbreviation || h.team.shortDisplayName) : '?';
    $('score').innerHTML = esc(an) + ' <span class="num">' + esc(a ? a.score : '') + '</span>' +
      '<span class="sep">at</span>' + esc(hn) + ' <span class="num">' + esc(h ? h.score : '') + '</span>';
    var st = comp.status || {};
    var bits = [(st.type && (st.type.shortDetail || st.type.detail)) || ''];
    if (state.sit && state.sit.offenseTeam) {
      bits.push('<span class="ball">' + esc(state.sit.offenseTeam.abbreviation ||
        state.sit.offenseTeam.shortDisplayName) + ' ball</span>');
    }
    $('hmeta').innerHTML = bits.filter(Boolean).join(' &middot; ');
    state.gameLabel = an + ' at ' + hn;
  }
  $('dot').className = 'dot' + (Date.now() - state.lastOk < STALE_MS ? ' ok' : '');
}
// The between-plays message is chosen from game state alone. It never
// consults what happened on the last play, so it cannot leak either.
function waitingMessage() {
  if (!state.gameId) return 'Pick a game to start.';
  if (state.gameState === 'pre') return 'Kickoff has not happened yet.';
  if (state.gameState === 'post') return 'Game over.';
  return 'Between plays. The last one is in the feed below.';
}
function quietPrime(msg) {
  var p = $('prime');
  p.className = '';
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
}
function renderPrime() {
  var sit = state.sit;
  if (!sit) {
    quietPrime(waitingMessage());
    return;
  }
  var teamKey = resolveTeam(sit.offenseTeam);
  var ten = lookupTendency(teamKey, sit.down, sit.distance, sit.yardsToGoal);
  var card = pickCard(sit, ten);

  $('pQuiet').hidden = true;
  document.querySelector('.pTop').hidden = false;
  $('pDD').textContent = sit.ddText || (sit.down + ' & ' + sit.distance);
  $('pSpot').textContent = (sit.spotText ? 'at ' + sit.spotText + ' · ' : '') + sit.yardsToGoal + ' to the end zone';

  if (!card) {
    $('pSit').textContent = '';
    $('pTen').textContent = '';
    $('pWatch').textContent = '';
    $('pQuiet').hidden = false;
    $('pQuiet').textContent = 'No read written for this one. Just watch.';
    $('pFoot').innerHTML = '';
    $('pDef').className = '';
    state.card = null;
    return;
  }

  var low = !ten || ten.confidence === 'low';
  var shortWatch = useShortWatch(card);
  var pr = card.prime;
  var tendLine = low ? (pr.tendency_low || pr.tendency) : pr.tendency;
  var watchLine = shortWatch ? (pr.watch_short || pr.watch) : pr.watch;

  $('pSit').textContent = fill(pr.situation, sit, ten);
  $('pTen').textContent = fill(tendLine, sit, ten);
  $('pWatch').textContent = fill(watchLine, sit, ten);

  var p = $('prime');
  p.className = low ? 'low' : '';

  // source chip: at low confidence the number is never attributed to the team
  var chips = [];
  if (ten) {
    if (ten.team) {
      chips.push('<span class="chip src">' + esc(ten.team) + ' · ' + seasonsLabel() +
        ' · n=' + ten.sample_size + '</span>');
    } else {
      chips.push('<span class="chip srcl">All offenses · n=' + ten.sample_size + '</span>');
    }
  } else {
    chips.push('<span class="chip srcl">no history for this spot</span>');
  }
  var cs = card.concepts || [];
  for (var i = 0; i < cs.length; i++) {
    var n = exposures(cs[i]);
    var known = n >= 2;
    chips.push('<button class="chip' + (known ? ' known' : '') + '" data-c="' + esc(cs[i]) + '">' +
      esc(cs[i].replace(/_/g, ' ')) + '<span class="st">' + n + '</span></button>');
  }
  $('pFoot').innerHTML = chips.join('');

  var def = $('pDef');
  if (state.openConcept && CARDS.concepts[state.openConcept] && cs.indexOf(state.openConcept) >= 0) {
    def.className = 'on';
    def.textContent = state.openConcept.replace(/_/g, ' ') + ': ' + CARDS.concepts[state.openConcept];
  } else {
    def.className = '';
    def.textContent = '';
  }
  state.card = card;
}
function renderFeed() {
  var el = $('feed');
  if (!state.feed.length) {
    el.innerHTML = '<div class="empty">Nothing yet.</div>';
    return;
  }
  var h = '';
  for (var i = 0; i < state.feed.length; i++) {
    var r = state.feed[i];
    h += '<div class="play">' +
      '<div class="pl1">' + (r.off ? '<b>' + esc(r.off) + '</b>' : '') +
      '<span>' + esc(r.dd) + '</span>' +
      '<span class="t num">' + esc(r.when) + '</span></div>' +
      '<div class="pl2 ' + r.kind + '">' + esc(r.plain) + '</div>' +
      (r.raw ? '<div class="pl3">' + esc(r.raw) + '</div>' : '') +
      '</div>';
  }
  el.innerHTML = h;
}
function renderPicker() {
  $('pickLbl').textContent = state.gameLabel || 'Pick a game';
  var live = state.games.filter(function (g) { return g.state === 'in'; }).length;
  $('pickSub').textContent = LEAGUES[state.league].label + ' · ' +
    (live ? live + ' live now' : 'nothing live right now');

  var segs = document.querySelectorAll('.seg button');
  for (var i = 0; i < segs.length; i++) {
    segs[i].className = segs[i].dataset.lg === state.league ? 'on' : '';
  }

  var groups = [
    ['Live now', state.games.filter(function (g) { return g.state === 'in'; })],
    ['Coming up', state.games.filter(function (g) { return g.state === 'pre'; })],
    ['Final', state.games.filter(function (g) { return g.state === 'post'; })]
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
      h += '<button class="gbtn' + (g.id === state.gameId ? ' sel' : '') + '" data-g="' + esc(g.id) + '">' +
        '<b>' + esc(g.name) + '</b><small>' + esc(sub) + '</small></button>';
    }
  }
  $('games').innerHTML = h || '<div class="empty">No games on the schedule today.</div>';

  var names = Object.keys(ledger.concepts).sort(function (a, b) {
    return exposures(b) - exposures(a);
  });
  var lh = '';
  for (var k = 0; k < names.length; k++) {
    lh += '<span class="chip">' + esc(names[k].replace(/_/g, ' ')) +
      '<span class="st"> ' + exposures(names[k]) + '</span></span>';
  }
  $('ledgerView').innerHTML = lh || '<span class="chip">nothing yet</span>';
  var learning = names.filter(function (n) { return exposures(n) >= 2; }).length;
  $('ledgerNote').textContent = names.length
    ? learning + ' of ' + names.length + ' past two sightings. Those cards drop the definition and get shorter.'
    : 'Terms you see on cards are counted here. After two sightings the card stops defining them.';
}

// ------------------------------------------------------------------ loop
var pollTimer = null, sbTimer = null;

function applySummary(sum) {
  var plays = collectPlays(sum);
  var hs = sum && sum.header && sum.header.competitions && sum.header.competitions[0] &&
           sum.header.competitions[0].status;
  state.gameState = (hs && hs.type && hs.type.state) || '';

  // FEED PATH
  state.feed = buildFeed(sum, plays);

  // PRIME PATH
  var sit = readSituation(sum, plays);
  var key = sit ? [sit.down, sit.distance, sit.yardsToGoal, sit.offenseTeam.id].join('|') : '';
  var isNew = key !== state.sitKey;
  state.sit = sit;
  state.sitKey = key;

  renderHeader(sum);
  renderPrime();
  renderFeed();

  if (isNew && sit && state.card) {
    bumpConcepts(state.card.concepts);   // counted after the card is built
    var p = $('prime');
    p.classList.add('fresh');
    setTimeout(function () { p.classList.remove('fresh'); }, 60);
  }
}

function pollGame() {
  clearTimeout(pollTimer);
  if (!state.gameId) { pollTimer = setTimeout(pollGame, POLL_MS); return; }
  jget(summaryUrl(state.league, state.gameId)).then(function (sum) {
    state.lastOk = Date.now();
    showErr('');
    applySummary(sum);
  }).catch(function (e) {
    showErr('feed: ' + e.message);
    $('dot').className = 'dot';
  }).then(function () {
    pollTimer = setTimeout(pollGame, POLL_MS);
  });
}

function pollScoreboard(force) {
  clearTimeout(sbTimer);
  var needed = force || state.sheet || !state.gameId;
  if (!needed) { sbTimer = setTimeout(function () { pollScoreboard(false); }, SB_MS); return; }
  fetchGames(state.league).then(function (rows) {
    state.games = rows;
    if (!state.gameId) {
      var live = rows.filter(function (g) { return g.state === 'in'; });
      if (live.length) selectGame(live[0].id);
    }
    renderPicker();
  }).catch(function (e) {
    showErr('scoreboard: ' + e.message);
  }).then(function () {
    sbTimer = setTimeout(function () { pollScoreboard(false); }, SB_MS);
  });
}

function selectGame(id) {
  state.gameId = String(id);
  state.sit = null; state.sitKey = ''; state.card = null; state.feed = [];
  state.openConcept = null;
  try { localStorage.setItem(LS.game + state.league, state.gameId); } catch (e) {}
  var g = state.games.filter(function (x) { return x.id === state.gameId; })[0];
  if (g) state.gameLabel = g.name;
  renderPicker();
  quietPrime(waitingMessage());
  renderFeed();
  pollGame();
}

function loadTables() {
  return jget(LEAGUES[state.league].table).then(function (t) {
    TEND = t;
    buildNameIndex();
  });
}
function switchLeague(lg) {
  if (lg === state.league) return;
  state.league = lg;
  try { localStorage.setItem(LS.league, lg); } catch (e) {}
  state.gameId = null; state.games = []; state.gameLabel = '';
  state.sit = null; state.sitKey = ''; state.feed = [];
  TEND = null; NAMEIX = null;
  renderPicker(); quietPrime('Pick a game to start.'); renderFeed();
  loadTables().then(function () {
    var saved = null;
    try { saved = localStorage.getItem(LS.game + lg); } catch (e) {}
    return fetchGames(lg).then(function (rows) {
      state.games = rows;
      var pick = rows.filter(function (g) { return g.id === saved && g.state !== 'post'; })[0] ||
                 rows.filter(function (g) { return g.state === 'in'; })[0];
      renderPicker();
      if (pick) selectGame(pick.id);
    });
  }).catch(function (e) { showErr('load: ' + e.message); });
}

// ------------------------------------------------------------------ wiring
$('pickBtn').addEventListener('click', function () {
  state.sheet = true;
  $('sheet').className = 'on';
  renderPicker();
  pollScoreboard(true);
});
$('closeSheet').addEventListener('click', function () {
  state.sheet = false;
  $('sheet').className = '';
});
$('sheet').addEventListener('click', function (ev) {
  if (ev.target === $('sheet')) { state.sheet = false; $('sheet').className = ''; }
});
$('games').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-g]');
  if (!b) return;
  selectGame(b.dataset.g);
  state.sheet = false;
  $('sheet').className = '';
});
document.querySelector('.seg').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-lg]');
  if (b) switchLeague(b.dataset.lg);
});
$('resetLedger').addEventListener('click', function () {
  ledger = { concepts: {} };
  saveLedger();
  renderPicker();
  renderPrime();
});
$('pFoot').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-c]');
  if (!b) return;
  state.openConcept = state.openConcept === b.dataset.c ? null : b.dataset.c;
  renderPrime();
});

// keep the screen awake; harmless where unsupported
var wl = null;
function keepAwake() {
  if (!navigator.wakeLock) return;
  navigator.wakeLock.request('screen').then(function (s) { wl = s; }).catch(function () {});
}
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') { keepAwake(); pollGame(); }
});

setInterval(function () {
  $('dot').className = 'dot' + (Date.now() - state.lastOk < STALE_MS ? ' ok' : '');
}, 1000);

// ------------------------------------------------------------------ boot
loadLedger();
try { state.league = localStorage.getItem(LS.league) === 'nfl' ? 'nfl' : 'cfb'; } catch (e) {}

Promise.all([
  jget('cards.json').then(function (c) { CARDS = c; }),
  loadTables()
]).then(function () {
  renderPicker();
  var saved = null;
  try { saved = localStorage.getItem(LS.game + state.league); } catch (e) {}
  return fetchGames(state.league).then(function (rows) {
    state.games = rows;
    var pick = rows.filter(function (g) { return g.id === saved && g.state !== 'post'; })[0] ||
               rows.filter(function (g) { return g.state === 'in'; })[0];
    renderPicker();
    if (pick) selectGame(pick.id);
    else quietPrime('Nothing live. Tap the button below to pick a game.');
  });
}).catch(function (e) {
  showErr('startup: ' + e.message);
}).then(function () {
  keepAwake();
  pollGame();
  pollScoreboard(false);
});

})();

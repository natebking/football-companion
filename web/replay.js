/* Pure prefix snapshots for bundled, finished-game replays. No network or DOM. */
(function (root) {
  'use strict';

  var VERSION = 'replay-1';
  var MARKER = /^(?:end\s|end of|two-minute|two minute)|timeout|official|coin toss/i;
  var TERMINAL = /^End (?:of )?Game$/i;

  function fail(message) { throw new Error('Invalid football replay: ' + message); }
  function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function string(value) { return typeof value === 'string' && value.trim() !== ''; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function validDate(value) { return string(value) && Number.isFinite(Date.parse(value)); }
  function marker(play) { return MARKER.test(String(play && play.type && play.type.text || '')); }
  function terminal(play) { return TERMINAL.test(String(play && play.type && play.type.text || '')); }

  function validateTeam(value, index) {
    if (!object(value) || !string(String(value.id || ''))) fail('team ' + index + ' has no id');
    if (value.homeAway !== 'home' && value.homeAway !== 'away') fail('team ' + index + ' has invalid homeAway');
    if (!object(value.team) || !string(String(value.team.id || ''))) fail('team ' + index + ' has no team identity');
    if ('score' in value || 'linescores' in value || 'statistics' in value || 'records' in value) {
      fail('team ' + index + ' contains final-game data');
    }
    if (value.team.logos !== undefined && !Array.isArray(value.team.logos)) fail('team ' + index + ' logos are invalid');
  }

  function validatePlay(value, index) {
    if (!object(value)) fail('play ' + index + ' is not an object');
    if (!string(String(value.id || ''))) fail('play ' + index + ' has no id');
    if (!string(String(value.driveId || ''))) fail('play ' + index + ' has no drive id');
    if (!object(value.type) || !string(value.type.text)) fail('play ' + index + ' has no type');
    if (value.period !== undefined && (!object(value.period) || !Number.isInteger(value.period.number) || value.period.number < 1)) {
      fail('play ' + index + ' has an invalid period');
    }
    if (value.clock !== undefined && (!object(value.clock) || !string(value.clock.displayValue))) {
      fail('play ' + index + ' has an invalid clock');
    }
    ['awayScore', 'homeScore'].forEach(function (field) {
      if (value[field] !== undefined && (!Number.isFinite(value[field]) || value[field] < 0)) {
        fail('play ' + index + ' has an invalid ' + field);
      }
    });
  }

  function dedupe(values) {
    var positions = Object.create(null), plays = [];
    values.forEach(function (raw, index) {
      validatePlay(raw, index);
      var play = clone(raw), id = String(play.id);
      play.id = id;
      play.driveId = String(play.driveId);
      if (positions[id] !== undefined) plays[positions[id]] = play;
      else { positions[id] = plays.length; plays.push(play); }
    });
    return plays;
  }

  function counts(plays) {
    var result = [0];
    plays.forEach(function (play, index) {
      if (!marker(play)) result.push(index + 1);
    });
    if (result[result.length - 1] !== plays.length) result.push(plays.length);
    return result;
  }

  function countAfter(plays, id, field) {
    var index = plays.findIndex(function (play) { return play.id === String(id); });
    if (index < 0) fail(field + ' references missing play ' + id);
    return index + 1;
  }

  function prepare(data) {
    if (!object(data)) fail('data is unavailable');
    if (data.schemaVersion !== 1 || data.kind !== 'football-replay') fail('unsupported schema');
    ['gameId', 'league', 'label', 'sourceUrl', 'sourceStatus', 'sourceNote'].forEach(function (field) {
      if (!string(data[field])) fail(field + ' is missing');
    });
    if (data.sourceStatus !== 'final') fail('source is not a final summary');
    if (!validDate(data.playedAt) || !validDate(data.retrievedAt)) fail('dates are invalid');
    if (!object(data.season) || !Number.isInteger(data.season.year) || !Number.isInteger(data.season.type)) {
      fail('season is invalid');
    }
    if (!Array.isArray(data.teams) || data.teams.length !== 2) fail('two teams are required');
    data.teams.forEach(validateTeam);
    if (data.teams.filter(function (team) { return team.homeAway === 'home'; }).length !== 1 ||
        data.teams.filter(function (team) { return team.homeAway === 'away'; }).length !== 1) fail('home and away teams are required');
    if (!Array.isArray(data.plays) || !data.plays.length) fail('play reports are unavailable');

    var plays = dedupe(data.plays);
    if (!terminal(plays[plays.length - 1])) fail('terminal game report is unavailable');
    var lastPeriod = 0;
    plays.forEach(function (play, index) {
      if (!play.period) return;
      if (play.period.number < lastPeriod) fail('play ' + index + ' is out of period order');
      lastPeriod = play.period.number;
    });
    if (!Array.isArray(data.momentSpecs) || !data.momentSpecs.length) fail('moments are unavailable');
    var moments = data.momentSpecs.map(function (spec, index) {
      if (!object(spec) || !string(spec.label)) fail('moment ' + index + ' is invalid');
      var count = spec.afterPlayId !== undefined ? countAfter(plays, spec.afterPlayId, 'moment ' + spec.label) : spec.count;
      if (!Number.isInteger(count) || count < 0 || count > plays.length) fail('moment ' + spec.label + ' has an invalid count');
      return { label: spec.label, count: count };
    });
    for (var i = 1; i < moments.length; i++) {
      if (moments[i].count < moments[i - 1].count) fail('moments are out of order');
    }
    var initialCount = countAfter(plays, data.initialAfterPlayId, 'initial point');
    var steps = counts(plays);
    if (steps.indexOf(initialCount) < 0) fail('initial point is not an action step');
    moments.forEach(function (moment) {
      if (steps.indexOf(moment.count) < 0) fail('moment ' + moment.label + ' is not an action step');
    });

    return {
      version: VERSION,
      gameId: data.gameId,
      league: data.league,
      label: data.label,
      playedAt: data.playedAt,
      sourceUrl: data.sourceUrl,
      retrievedAt: data.retrievedAt,
      sourceNote: data.sourceNote,
      season: clone(data.season),
      teams: clone(data.teams),
      plays: plays,
      steps: steps,
      moments: moments,
      initialCount: initialCount
    };
  }

  function statusFor(prefix, complete) {
    var last = prefix[prefix.length - 1];
    var period = last && last.period && last.period.number || null;
    var clock = last && last.clock && last.clock.displayValue || null;
    var halftime = last && period === 2 && (/^End Period$/i.test(String(last.type && last.type.text || '')) ||
      /^End (?:of )?(?:the )?2nd/i.test(String(last.text || '')));
    var name = complete ? 'STATUS_FINAL' : halftime ? 'STATUS_HALFTIME' : prefix.length ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED';
    var state = complete ? 'post' : prefix.length ? 'in' : 'pre';
    var detail = complete ? 'Final' : halftime ? 'Halftime' : prefix.length ?
      (period ? 'Q' + period + (clock ? ' · ' + clock : '') : clock || 'Replay in progress') : 'Replay start';
    var status = { type: { name: name, state: state, completed: complete, description: detail, detail: detail, shortDetail: detail } };
    if (period !== null) status.period = period;
    if (clock !== null) { status.displayClock = clock; status.clock = clock; }
    return status;
  }

  function prefixScore(plays, field) {
    var score = null;
    plays.forEach(function (play) {
      if (Number.isFinite(play[field])) score = play[field];
      else if (play.scoringPlay === true) score = null;
    });
    return score;
  }

  function snapshot(model, count) {
    if (!object(model) || !Array.isArray(model.plays) || !Array.isArray(model.teams)) fail('prepared model is required');
    if (!Number.isInteger(count) || count < 0 || count > model.plays.length) throw new RangeError('Replay count is out of bounds');
    var prefix = clone(model.plays.slice(0, count));
    var awayScore = prefixScore(prefix, 'awayScore');
    var homeScore = prefixScore(prefix, 'homeScore');
    var competitors = clone(model.teams).map(function (team) {
      team.score = team.homeAway === 'home' ? homeScore : awayScore;
      return team;
    });
    var drivePositions = Object.create(null), previous = [];
    prefix.forEach(function (play) {
      var id = String(play.driveId), index = drivePositions[id];
      if (index === undefined) {
        index = previous.length;
        drivePositions[id] = index;
        previous.push({ id: id, plays: [] });
      }
      previous[index].plays.push(play);
    });
    return {
      header: {
        id: model.gameId,
        name: model.label,
        shortName: model.label,
        season: clone(model.season),
        competitions: [{
          id: model.gameId,
          date: model.playedAt,
          competitors: competitors,
          status: statusFor(prefix, count === model.plays.length)
        }]
      },
      drives: { previous: previous }
    };
  }

  var api = { version: VERSION, prepare: prepare, snapshot: snapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FootballReplay = api;
})(typeof window !== 'undefined' ? window : null);

/* Pure final-summary adapters and prefix snapshots. No network or DOM. */
(function (root) {
  'use strict';

  var VERSION = 'replay-2';
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
    var initialCount = data.initialCount === 0 ? 0 : countAfter(plays, data.initialAfterPlayId, 'initial point');
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

  // Copy only fields consumed by the play reader. Nested source metadata, final
  // totals, leaders, drive outcomes and future-next-play blocks never enter a model.
  function pick(value, fields) {
    var result = {};
    if (!object(value)) return result;
    fields.forEach(function (field) {
      var item = value[field];
      if (typeof item === 'string' || typeof item === 'boolean' ||
          (typeof item === 'number' && Number.isFinite(item))) result[field] = item;
    });
    return result;
  }

  function playReport(raw, driveId) {
    if (!object(raw)) fail('a play report is invalid');
    var play = pick(raw, ['id', 'sequenceNumber', 'text', 'awayScore', 'homeScore',
      'scoringPlay', 'isPenalty', 'isTurnover', 'statYardage', 'scoreValue',
      'modified', 'wallclock', 'airYards', 'yardsAfterCatch', 'air_yards',
      'yards_after_catch', 'complete_pass']);
    play.driveId = String(driveId || raw.driveId || '');
    play.type = pick(raw.type, ['id', 'text', 'abbreviation']);
    if (raw.period !== undefined) play.period = pick(raw.period, ['number']);
    if (raw.clock !== undefined) play.clock = pick(raw.clock, ['displayValue']);
    ['start', 'end'].forEach(function (field) {
      if (!object(raw[field])) return;
      play[field] = pick(raw[field], ['down', 'distance', 'yardLine', 'yardsToEndzone',
        'downDistanceText', 'shortDownDistanceText', 'possessionText']);
      if (object(raw[field].team)) play[field].team = pick(raw[field].team, ['id']);
    });
    ['scoringType', 'pointAfterAttempt'].forEach(function (field) {
      if (object(raw[field])) play[field] = pick(raw[field], ['id', 'name', 'text', 'abbreviation', 'value']);
      else if (typeof raw[field] === 'boolean') play[field] = raw[field];
    });
    return play;
  }

  function fromSummary(summary, options) {
    options = options || {};
    if (options.league !== 'cfb' && options.league !== 'nfl') fail('league must be cfb or nfl');
    if (!string(options.gameId) || !/^\d+$/.test(options.gameId)) fail('game id must be an ESPN event id');
    if (!object(summary) || !object(summary.header)) fail('finished summary is unavailable');
    var header = summary.header;
    var competition = Array.isArray(header.competitions) && header.competitions[0];
    if (String(header.id || '') !== options.gameId || !object(competition) ||
        String(competition.id || '') !== options.gameId) fail('summary does not match the requested game');
    var status = competition.status && competition.status.type;
    if (!status || status.completed !== true || status.state !== 'post' ||
        !/^STATUS_FINAL(?:_|$)/.test(String(status.name || ''))) fail('source is not a final summary');
    var teams = (competition.competitors || []).map(function (competitor) {
      var team = pick(competitor.team, ['id', 'location', 'name', 'nickname',
        'abbreviation', 'displayName', 'shortDisplayName', 'color', 'alternateColor']);
      team.logos = ((competitor.team || {}).logos || []).map(function (logo) { return pick(logo, ['href', 'alt']); });
      return { id: String(competitor.id || ''), homeAway: competitor.homeAway, team: team };
    });
    var drives = summary.drives || {};
    var groups = Array.isArray(drives.previous) ? drives.previous.slice() : [];
    // ESPN can keep the last possession in current even after the game is final.
    if (object(drives.current)) groups.push(drives.current);
    var reports = [];
    groups.forEach(function (drive) {
      if (!object(drive)) fail('a drive report is invalid');
      if (!Array.isArray(drive.plays)) return;
      drive.plays.forEach(function (play) { reports.push(playReport(play, drive.id)); });
    });
    if (!reports.length) fail('play-by-play reports are unavailable for this finished game');
    var plays = dedupe(reports);
    if (!terminal(plays[plays.length - 1])) {
      var last = plays[plays.length - 1];
      // The header proves completion, but supplies no scores or clock. Releasing
      // this explicit final marker leaves missing report values unknown.
      var end = { id: options.gameId + ':replay-final', driveId: last.driveId,
        type: { text: 'End of Game' }, text: 'Game finished (final summary).'};
      if (last.period) end.period = clone(last.period);
      if (last.clock) end.clock = clone(last.clock);
      plays.push(end);
    }
    var moments = [{ label: 'Start', count: 0 }], periods = Object.create(null);
    plays.forEach(function (play, index) {
      var period = play.period && play.period.number;
      if (!period || periods[period] || marker(play)) return;
      periods[period] = true;
      if (period === 1) return;
      moments.push({ label: period > 4 ? 'Overtime ' + (period - 4) : 'Quarter ' + period, count: index + 1 });
    });
    moments.push({ label: 'Final', count: plays.length });
    var away = teams.find(function (team) { return team.homeAway === 'away'; });
    var home = teams.find(function (team) { return team.homeAway === 'home'; });
    function name(team) { return team && ((options.league === 'nfl' && team.team.name) ||
      team.team.shortDisplayName || team.team.location || team.team.displayName || team.team.abbreviation); }
    return prepare({ schemaVersion: 1, kind: 'football-replay', gameId: options.gameId,
      league: options.league, label: name(away) + ' at ' + name(home),
      playedAt: competition.date, retrievedAt: options.retrievedAt || new Date().toISOString(),
      sourceUrl: 'https://site.api.espn.com/apis/site/v2/sports/football/' +
        (options.league === 'cfb' ? 'college-football' : 'nfl') + '/summary?event=' + options.gameId,
      sourceStatus: 'final', sourceNote: 'Final ESPN play reports can differ from reports released live.',
      season: pick(header.season, ['year', 'type']), teams: teams,
      plays: plays, momentSpecs: moments, initialCount: 0 });
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
      (period ? (period > 4 ? 'OT' + (period - 4) : 'Q' + period) + (clock ? ' · ' + clock : '') : clock || 'Replay in progress') : 'Replay start';
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

  var api = { version: VERSION, prepare: prepare, fromSummary: fromSummary, snapshot: snapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FootballReplay = api;
})(typeof window !== 'undefined' ? window : null);

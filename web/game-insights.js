/* Recomputed observations from released play reports. No clocks, predictions,
 * drive metadata totals, or assumed missing plays enter these calculations. */
(function (root) {
  'use strict';
  var playFacts = typeof module !== 'undefined' && module.exports ? require('./play-facts.js') : root.FootballPlay;

  function teamId(p) { return p.start && p.start.team && String(p.start.team.id || ''); }
  function count(n, word) { return n + ' ' + word + (n === 1 ? '' : word === 'catch' ? 'es' : 's'); }
  function reportText(p) {
    var text = String(p.text || '').split(/\bOriginal Play:/i)[0];
    var attempt = /\b(?:kick|pass|rush|run) attempt\b/i.exec(text);
    return attempt && /\bTOUCHDOWN\b/i.test(text.slice(0, attempt.index)) ? text.slice(0, attempt.index) : text;
  }
  function row(p, abbr) {
    var f = playFacts.describe(p, abbr), text = reportText(p), type = String((p.type || {}).text || '');
    var marker = /timeout|^end |^end of|^two.minute|official|coin toss/i.test(type);
    var noPlay = /\bno play\b|\bnullified\b/i.test(text);
    var penalty = /^A penalty affected/.test(f.voidReason || '');
    var sack = !penalty && !noPlay && /\bsacked\b/i.test(text);
    var clockPlay = !penalty && /\bkneel|\bspike[ds]?\b/i.test(text);
    var action = !marker && !noPlay && !penalty ?
      (sack ? 'sack' : f.outcome === 'run' || f.outcome === 'pass' ? f.outcome : '') : '';
    return { p: p, f: f, text: text, teamId: teamId(p), marker: marker, noPlay: noPlay,
      penalty: penalty, sack: sack, clockPlay: clockPlay, action: action,
      kickoff: /kickoff/i.test(type), conversion: /extra point|two.point/i.test(type),
      offensivePlay: !!action || clockPlay || (!!f.movement && penalty && !noPlay && /\b(?:rush|run|pass|sacked)\b/i.test(text.split(/\bPENALTY\b/i)[0])) };
  }

  function directionCounts() { return { left: 0, middle: 0, right: 0, known: 0, total: 0 }; }
  function newTeam(id, abbr) {
    return { teamId: id, team: abbr[id] || 'Team ' + id, summaries: [],
      earlyDowns: { runs: 0, passes: 0, sacks: 0, total: 0 },
      directions: { run: directionCounts(), pass: directionCounts() },
      receivers: [], runners: [],
      thirdDowns: { attempts: 0, knownDistances: 0, long: 0, conversions: 0, throws: 0, namedTargets: 0, receivers: [], playIds: [] },
      playIds: [],
      coverage: { reports: 0, observedPlays: 0, excludedReports: 0, namedTargets: 0, passes: 0,
        namedCarries: 0, runs: 0, verifiedYardage: 0, text: '' } };
  }
  function named(list, name, receiver) {
    var entry = list.find(function (item) { return item.name === name; });
    if (!entry) { entry = receiver ? { name: name, targets: 0, catches: 0, yards: 0 } : { name: name, carries: 0, yards: 0 }; list.push(entry); }
    return entry;
  }
  function addYards(entry, yards) { entry.yards = entry.yards === null || yards === null ? null : entry.yards + yards; }
  function observe(team, r) {
    var f = r.f, action = r.action, c = team.coverage;
    c.reports++;
    if (!action || r.clockPlay) { c.excludedReports++; return; }
    c.observedPlays++;
    team.playIds.push(String(r.p.id));
    if ((r.p.start || {}).down === 3) {
      var third = team.thirdDowns;
      third.attempts++;
      third.playIds.push(String(r.p.id));
      var distance = (r.p.start || {}).distance;
      if (Number.isInteger(distance) && distance > 0) {
        third.knownDistances++;
        if (distance >= 7) third.long++;
      }
      if (!f.turnover && Number.isFinite(f.gained) && Number.isFinite(f.need) && f.gained >= f.need) third.conversions++;
      if (action === 'pass') {
        third.throws++;
        if (f.people.receiver) {
          third.namedTargets++;
          named(third.receivers, f.people.receiver, true).targets++;
        }
      }
    }
    if (f.gained !== null || r.sack && f.movement) c.verifiedYardage++;
    if ((r.p.start || {}).down === 1 || (r.p.start || {}).down === 2) {
      team.earlyDowns[action === 'run' ? 'runs' : action === 'pass' ? 'passes' : 'sacks']++;
      team.earlyDowns.total++;
    }
    if (action === 'run' || action === 'pass') {
      var d = team.directions[action]; d.total++;
      var fact = f.facts.find(function (item) { return action === 'run' ? /^Run (?:to the|through the) /.test(item) : /^(?:Short|Deep) pass /.test(item); });
      var direction = fact && /\b(left|middle|right)\b/.exec(fact);
      if (direction) { d[direction[1]]++; d.known++; }
    }
    if (action === 'run') {
      c.runs++;
      if (f.people.runner) {
        c.namedCarries++;
        var runner = named(team.runners, f.people.runner, false); runner.carries++; addYards(runner, f.gained);
      }
    } else if (action === 'pass') {
      c.passes++;
      if (f.people.receiver) {
        c.namedTargets++;
        var receiver = named(team.receivers, f.people.receiver, true); receiver.targets++;
        var complete = !/\bincomplete\b|\bintercepted\b/i.test(r.text) &&
          (/\bpass complete\b/i.test(r.text) || /reception/i.test((r.p.type || {}).text || ''));
        if (complete) { receiver.catches++; addYards(receiver, f.gained); }
      }
    }
  }
  function finishTeam(team) {
    var e = team.earlyDowns, c = team.coverage;
    if (e.total) team.summaries.push('On first and second down: ' + count(e.runs, 'run') + ', ' + count(e.passes, 'throw') +
      (e.sacks ? ' and ' + count(e.sacks, 'sack') : '') + '.');
    ['pass', 'run'].forEach(function (action) {
      var d = team.directions[action];
      if (d.known) team.summaries.push((action === 'pass' ? 'Reported throws' : 'Reported runs') + ': ' + d.left + ' left, ' + d.middle + ' middle, ' + d.right +
        ' right. Direction available for ' + d.known + ' of ' + d.total + '.');
    });
    team.receivers.sort(function (a, b) { return b.targets - a.targets || a.name.localeCompare(b.name); });
    team.runners.sort(function (a, b) { return b.carries - a.carries || a.name.localeCompare(b.name); });
    if (team.receivers.length) {
      var receiver = team.receivers[0];
      team.summaries.push(receiver.name + ': ' + count(receiver.targets, 'reported target') + ', ' + count(receiver.catches, 'catch') +
        (receiver.yards === null ? '. Yardage is incomplete.' : ' for ' + count(receiver.yards, 'yard') + '.'));
    }
    if (team.runners.length) {
      var runner = team.runners[0];
      team.summaries.push(runner.name + ': ' + runner.carries + ' reported ' + (runner.carries === 1 ? 'carry' : 'carries') +
        (runner.yards === null ? '. Yardage is incomplete.' : ' for ' + count(runner.yards, 'yard') + '.'));
    }
    c.text = 'From ' + count(c.observedPlays, 'reported offensive play') + '. Penalties, clock-stopping plays and special teams are excluded. ' +
      'Receiver named on ' + c.namedTargets + ' of ' + c.passes + ' throws; runner named on ' + c.namedCarries + ' of ' + c.runs + ' runs.';
    return team;
  }

  function ending(r) {
    if (r.f.turnover) return /^Turnover on downs\./.test(r.f.consequence) ? 'Turnover on downs.' : 'Ended with a turnover.';
    if (r.f.kind === 'score') return /touchdown/i.test(r.f.summary) ? 'Touchdown.' : r.f.summary;
    var nextTeam = r.p.end && r.p.end.team && String(r.p.end.team.id || '');
    var changed = r.teamId && nextTeam && r.teamId !== nextTeam;
    if (/punt/i.test((r.p.type || {}).text || '') && !r.penalty && changed) return 'Ended with a punt.';
    if (/field goal/i.test((r.p.type || {}).text || '') && !r.penalty && changed) return r.f.summary;
    if (/^end (?:of )?(?:half|game)/i.test((r.p.type || {}).text || '')) return 'The period of play ended.';
    return '';
  }

  function latestDrive(rows, abbr) {
    var last = null;
    rows.forEach(function (r) { if (r.p.driveId && !r.marker && !r.kickoff && !r.conversion) last = r; });
    if (!last) return null;
    var id = String(last.p.driveId), members = rows.filter(function (r) { return String(r.p.driveId || '') === id; });
    var first = members.find(function (r) { return !r.marker && !r.kickoff && !r.conversion && r.f.outcome !== 'kick'; }) || last;
    if (!first.teamId) return null;
    var result = { id: id, teamId: first.teamId, team: abbr[first.teamId] || 'Team ' + first.teamId,
      label: 'Latest drive', summary: '', complete: false, verified: true, playCount: 0,
      netYards: null, playYards: null, penaltyYards: null, progress: [],
      sacks: 0, playIds: [],
      coverage: { reports: 0, verifiedMovements: 0, unverifiedReports: 0 } };
    var previous = null, playTotal = 0, penaltyTotal = 0, end = '', started = false;
    members.forEach(function (r) {
      if (r.kickoff || r.conversion) return;
      if (r.marker) { end = ending(r) || end; return; }
      // Some sources attach the preceding kick to the receiving drive.
      if (!started && r.f.outcome === 'kick' && r.teamId !== result.teamId) return;
      if (r.f.outcome === 'kick' && r.teamId === result.teamId && !r.penalty) {
        if (previous !== null && r.f.startYardsToGoal !== previous) result.verified = false;
        end = ending(r) || end; return;
      }
      if (/^\s*PENALTY\b/i.test(r.text) && /\bdeclined\b/i.test(r.text) && !r.penalty && !r.noPlay) return;
      result.coverage.reports++;
      result.playIds.push(String(r.p.id));
      if (r.action === 'sack') result.sacks++;
      if (!started) {
        started = true;
        if ((r.p.start || {}).down !== 1) result.verified = false;
      }
      if (r.offensivePlay) result.playCount++;
      var m = r.f.movement;
      if (r.teamId !== result.teamId || !m) { result.verified = false; result.coverage.unverifiedReports++; }
      else {
        if (previous !== null && previous !== m.start) result.verified = false;
        previous = m.end;
        result.coverage.verifiedMovements++;
        playTotal += m.play; penaltyTotal += m.penalty;
        var from = 100 - m.start, afterPlay = from + m.play;
        if (m.play !== 0 || m.penalty === 0) result.progress.push({ id: String(r.p.id), from: from, to: afterPlay, kind: 'play', label: r.f.summary });
        if (m.penalty !== 0) result.progress.push({ id: String(r.p.id), from: afterPlay, to: 100 - m.end, kind: 'penalty',
          label: count(Math.abs(m.penalty), 'yard') + (m.penalty > 0 ? ' forward' : ' back') + ' for the penalty.' });
      }
      end = ending(r) || end;
    });
    result.complete = !!end;
    result.verified = result.verified && result.coverage.verifiedMovements > 0;
    if (result.verified) {
      result.playYards = playTotal; result.penaltyYards = penaltyTotal; result.netYards = playTotal + penaltyTotal;
      result.summary = count(result.playCount, 'play') + ' moved ' + result.team + ' ' +
        (result.netYards < 0 ? 'back ' : '') + count(Math.abs(result.netYards), 'yard') + '.';
      if (penaltyTotal) result.summary += ' ' + count(Math.abs(playTotal), 'yard') + (playTotal < 0 ? ' lost' : ' gained') +
        ' on plays; penalties moved the ball ' + count(Math.abs(penaltyTotal), 'yard') + (penaltyTotal > 0 ? ' forward.' : ' back.');
    } else result.summary = 'The play reports do not support a complete yardage total for this drive.';
    if (end) result.summary += ' ' + end;
    return result;
  }

  function summarize(plays, options) {
    plays = Array.isArray(plays) ? plays : []; options = options || {};
    var abbr = options.teamAbbreviations || {}, unique = new Map(), unidentified = 0;
    // Replacement keeps the original chronological position. Re-running after a
    // correction removes every old contribution, including player/direction counts.
    plays.forEach(function (p) {
      if (!p || p.id === undefined || p.id === null || p.id === '') { unidentified++; return; }
      unique.set(String(p.id), p);
    });
    var rows = Array.from(unique.values()).map(function (p) { return row(p, abbr); }), teams = new Map();
    var coverage = { inputReports: plays.length, uniqueReports: rows.length, unidentifiedReports: unidentified,
      reportsWithDrive: 0, unassignedReports: 0, text: 'Counts cover the released play reports, not a prediction of the next play.' };
    rows.forEach(function (r) {
      if (r.p.driveId) coverage.reportsWithDrive++;
      if (!r.teamId) { coverage.unassignedReports++; return; }
      if (!teams.has(r.teamId)) teams.set(r.teamId, newTeam(r.teamId, abbr));
      observe(teams.get(r.teamId), r);
    });
    return { drive: latestDrive(rows, abbr), teams: Array.from(teams.values()).filter(function (team) { return team.coverage.observedPlays > 0; }).map(finishTeam), coverage: coverage };
  }

  // Explicit whitelist for the main read. Only aggregates of released reports
  // cross into PRIME; no raw play text or live source object is included.
  function forRead(summary, gameId) {
    var d = summary.drive;
    return {
      gameId: String(gameId || ''),
      drive: d ? { id: d.id, teamId: d.teamId, complete: d.complete, verified: d.verified,
        playCount: d.playCount, playYards: d.playYards, penaltyYards: d.penaltyYards,
        sacks: d.sacks, playIds: d.playIds.slice() } : null,
      teams: summary.teams.map(function (t) { return { teamId: t.teamId, team: t.team,
        earlyDowns: Object.assign({}, t.earlyDowns), playIds: t.playIds.slice(),
        thirdDowns: { attempts: t.thirdDowns.attempts, knownDistances: t.thirdDowns.knownDistances, long: t.thirdDowns.long,
          conversions: t.thirdDowns.conversions, throws: t.thirdDowns.throws,
          namedTargets: t.thirdDowns.namedTargets, playIds: t.thirdDowns.playIds.slice(),
          receivers: t.thirdDowns.receivers.map(function (r) { return { name: r.name, targets: r.targets }; }) }
      }; })
    };
  }

  var api = { summarize: summarize, forRead: forRead };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FootballInsights = api;
})(typeof window !== 'undefined' ? window : null);

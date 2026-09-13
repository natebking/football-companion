/* One evidence-backed read for the current situation. No network or DOM.
 * Input: approved pre-snap context, aggregates of released plays, and prior
 * selections. An observation never establishes the next formation or call. */
(function (root) {
  'use strict';
  var VERSION = 'read-6';
  var history = typeof module !== 'undefined' && module.exports ? require('./game-history.js') : root.FootballHistory;
  function valid(s) {
    return s && Number.isInteger(s.down) && s.down >= 1 && s.down <= 4 &&
      Number.isInteger(s.distance) && s.distance >= 1 && Number.isInteger(s.yardsToGoal) &&
      s.yardsToGoal >= 1 && s.yardsToGoal <= 99 && s.distance <= s.yardsToGoal &&
      !((s.period === 2 || s.period === 4) && s.clockSeconds === 0);
  }
  function candidate(id, priority, headline, detail, watch, options) {
    return Object.assign({ id: id, version: VERSION, priority: priority, headline: headline,
      detail: detail, watch: watch || '', lessonId: null, question: null,
      source: 'Score, clock and field position', playIds: [], key: id, focus: null }, options);
  }
  function reportedCount(value) { return Number.isInteger(value) && value >= 0; }
  function leaders(players, field) {
    if (!Array.isArray(players)) return [];
    return players.filter(function (p) { return p && typeof p.name === 'string' && p.name.trim() && reportedCount(p[field]); })
      .slice().sort(function (a, b) { return b[field] - a[field] || a.name.localeCompare(b.name); });
  }
  function namedLeader(players, field, minimum, total, namedCount, minimumCoverage, minimumShare) {
    if (!reportedCount(total) || total < minimum || !reportedCount(namedCount) || namedCount > total || namedCount / total < minimumCoverage) return null;
    var ranked = leaders(players, field), top = ranked[0];
    if (ranked.reduce(function (sum, p) { return sum + p[field]; }, 0) !== namedCount) return null;
    if (!top || top[field] < minimum || top[field] > namedCount || top[field] / total < minimumShare) return null;
    if (ranked[1] && ranked[1][field] === top[field]) return null;
    return top;
  }
  function playerCandidate(s, scope, role, player, total, namedCount, playIds, priority, key) {
    if (!Array.isArray(playIds) || playIds.length !== total || new Set(playIds).size !== playIds.length ||
        playIds.some(function (id) { return typeof id !== 'string' || !id; })) return null;
    var receiving = role === 'receiver', uses = player[receiving ? 'targets' : 'carries'];
    var unit = receiving ? 'reported throws' : 'reported runs';
    var context = scope === 'third_down' ? ' on third down' : scope === 'drive' ? ' on this drive' : ' in this game';
    var detail = uses + ' of ' + total + ' ' + unit + context + ' have gone ' + (receiving ? 'toward ' : 'to ') + player.name + '.';
    if (namedCount < total) detail += ' ' + (receiving ? 'A receiver' : 'A runner') + ' is named on ' + namedCount + ' of the ' + total + ' reports.';
    var watch = 'Find ' + player.name + ' before the snap. ';
    if (receiving && s.down === 3) watch += 'If a pass goes that way, compare the target or catch point with the first-down line.';
    else if (receiving) watch += 'Watch the first few steps and how much room there is if a throw goes that way.';
    else watch += 'On a run, watch the first cut and where the first contact comes.';
    return candidate(scope === 'third_down' ? 'third_down_target' : scope === 'drive' ? 'drive_player' : 'game_player', priority,
      'Watch ' + player.name + (scope === 'third_down' ? ' on this third down.' : '.'), detail, watch,
      { source: 'ESPN · released ' + (scope === 'drive' ? 'drive' : 'game') + ' reports · count, not a forecast',
        playIds: Array.isArray(playIds) ? playIds.slice() : [], key: key,
        focus: { name: player.name, role: role } });
  }
  function fieldPosition(yardsToGoal) {
    if (yardsToGoal === 50) return 'midfield';
    return yardsToGoal > 50 ? 'their own ' + (100 - yardsToGoal) : 'the opponent’s ' + yardsToGoal;
  }
  // Age evidence in released offensive actions, not clock ticks, card views,
  // penalties or the other team's possession. This also works after a seek.
  function actionsSinceInvolvement(team, focus) {
    var ids = team && team.playIds;
    var player = team && ((focus.role === 'runner' ? team.runners : team.receivers) || [])
      .find(function (p) { return p.name === focus.name; });
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length ||
        !player || !Array.isArray(player.playIds) || !player.playIds.length ||
        player.playIds.some(function (id) { return ids.indexOf(id) < 0; })) return null;
    for (var i = ids.length - 1; i >= 0; i--) {
      if (player.playIds.indexOf(ids[i]) >= 0) return ids.length - i - 1;
    }
    return null;
  }
  function candidates(s, evidence, past) {
    if (!valid(s)) return [];
    var list = [], goal = s.distance === s.yardsToGoal;
    // Overall carry share alone is not enough to spotlight a runner on a
    // long third down. Use a supported receiver or the conversion context.
    var runFocusFits = s.down < 3 || s.distance < 7;
    var clockKnown = Number.isFinite(s.clockSeconds), scoreKnown = Number.isFinite(s.scoreDiff);
    var late = s.period === 4 && clockKnown && s.clockSeconds <= 300;
    var off = s.offenseTeam && String(s.offenseTeam.id || '');
    var e = evidence && evidence.gameId === String(s.gameId) ? evidence : null;
    var team = e && e.teams.find(function (t) { return t.teamId === off; });
    var d = e && e.drive && e.drive.teamId === off && !e.drive.complete ? e.drive : null;
    function add(c) { if (c) list.push(c); }
    if (s.down === 4) {
      var headline, detail, watch = 'Watch whether the offense stays on the field.', variant;
      var stalled = d && d.verified && reportedCount(d.sacks) && d.sacks >= 1 && Number.isInteger(d.penaltyYards) &&
        d.penaltyYards <= -10 && s.distance >= 15;
      if (stalled) {
        variant = 'stalled:' + d.id;
        headline = 'Penalties and ' + (d.sacks === 1 ? 'a sack have' : d.sacks + ' sacks have') + ' backed up this drive.';
        detail = 'The reports show ' + Math.abs(d.penaltyYards) + ' yards lost to penalties and ' + d.sacks +
          (d.sacks === 1 ? ' sack' : ' sacks') + ' on this drive. They now need ' + s.distance + ' yards from ' + fieldPosition(s.yardsToGoal) + '.';
        watch = 'Watch whether the offense stays out or the punt unit comes on.';
      } else if (late && scoreKnown && s.scoreDiff <= -4 && s.scoreDiff >= -8) {
        variant = 'need_touchdown';
        headline = 'A field goal would still leave them behind.';
        detail = 'Trailing by ' + Math.abs(s.scoreDiff) + ', they need a touchdown to tie or take the lead. Converting keeps that chance alive on this possession.';
      } else if (late && scoreKnown && s.scoreDiff < -8) {
        variant = 'two_scores'; headline = 'They need more than one score, and another possession.';
        detail = 'Down ' + Math.abs(s.scoreDiff) + ', the decision includes how much time a failed conversion or a kick leaves for getting the ball back.';
      } else if (late && scoreKnown && s.scoreDiff > 0) {
        variant = 'protect_lead'; headline = 'A conversion would let them keep the ball and use more clock.';
        detail = 'They lead by ' + s.scoreDiff + '. A kick gives up possession; a failed conversion gives the opponent the ball here. Field position and time both matter.';
      } else if (late && scoreKnown && s.scoreDiff >= -3 && s.scoreDiff <= 0 && s.yardsToGoal <= 35) {
        variant = 'kick_lead'; headline = s.scoreDiff === -3 ? 'A field goal could tie it; a touchdown could put them ahead.' : 'A field goal could put them ahead.';
        detail = 'The ball is ' + s.yardsToGoal + ' yards from the end zone. Going for it keeps the drive alive if they convert, but a miss gives up possession.';
      } else if (goal) {
        variant = 'goal'; headline = 'One play to finish this drive with a touchdown.';
        detail = 'A field goal offers three points. Going for the end zone risks coming away empty, but keeps seven in reach with the extra point.';
      } else if (s.yardsToGoal <= 40) {
        variant = 'range'; headline = 'The kick-versus-conversion decision starts here.';
        detail = 'They need ' + s.distance + ' yards. The ball is ' + s.yardsToGoal + ' yards from the end zone; the actual kick is longer. Kicker range matters as well as the chance to convert.';
      } else {
        variant = 'field'; headline = 'Keep the possession, or make the other offense travel farther?';
        detail = 'Going for ' + s.distance + ' yards risks giving the opponent the ball here. A punt trades this possession for field position.';
      }
      add(candidate('fourth_down', 100, headline, detail, watch, {
        key: 'fourth_down:' + variant, question: { kind: 'gokick', q: 'Will they keep the offense out or bring on the kicking team?' },
        source: stalled ? 'ESPN · released drive reports' : 'Score, clock and field position',
        playIds: stalled ? d.playIds.slice() : []
      }));
      return list;
    } else if (late && scoreKnown && s.scoreDiff < 0) {
      add(candidate('chasing_score', 96, 'They need points without using up this possession’s time.',
        'Down ' + Math.abs(s.scoreDiff) + ' with ' + Math.floor(s.clockSeconds / 60) + ':' + String(s.clockSeconds % 60).padStart(2, '0') +
        ' left. A short gain inbounds also uses clock unless it is stopped.',
        'After a catch, watch where the runner finishes relative to the sideline.', { lessonId: 'catch_and_run' }));
    } else if (late && scoreKnown && s.scoreDiff > 0 && s.scoreDiff <= 16) {
      add(candidate('protect_clock', 96, 'A first down would help them keep the ball and use the clock.',
        'They lead by ' + s.scoreDiff + ' with ' + Math.floor(s.clockSeconds / 60) + ':' + String(s.clockSeconds % 60).padStart(2, '0') +
        ' left. Another set of downs would make it harder for the opponent to get the ball back in time.',
        'Watch whether the runner stays inbounds, and whether the defense uses a timeout.'));
    }
    if (d && d.verified && d.playCount >= 2 && d.penaltyYards >= 10 && d.penaltyYards > Math.max(0, d.playYards)) {
      add(candidate('penalty_progress', 95, 'Flags have moved this drive farther than the offense’s plays.',
        'Penalties: ' + d.penaltyYards + ' yards forward. Plays: ' + (d.playYards < 0 ? Math.abs(d.playYards) + ' yards lost' : d.playYards + ' yards gained') + '.',
        '', { source: 'ESPN · released drive reports', playIds: d.playIds, key: 'penalty_progress:' + d.id }));
    }
    if (team) {
      var t = team.thirdDowns;
      var receiver = t && namedLeader(t.receivers, 'targets', 2, t.throws, t.namedTargets, 2 / 3, .5);
      if (s.down === 3 && receiver) {
        add(playerCandidate(s, 'third_down', 'receiver', receiver, t.throws, t.namedTargets,
          t.throwPlayIds, 94, 'third_down_target:' + off + ':' + receiver.name));
      }
      if (t && t.attempts >= 4 && t.knownDistances === t.attempts && t.long >= 3 && t.long / t.attempts >= 0.6) {
        add(candidate('long_thirds', s.down >= 2 && s.distance >= 7 ? 75 : 49, 'Long third downs are making these possessions harder.',
          t.long + ' of ' + t.attempts + ' reported third-down plays needed at least seven yards.',
          s.down < 3 ? 'Watch how much the next play leaves them to gain.' : 'Watch where the catch happens relative to the first-down line.',
          { source: 'ESPN · third downs this game', playIds: t.playIds, lessonId: 'first_down_line',
            key: 'long_thirds:' + off }));
      }
      var tc = team.coverage || {}, ta = team.actions || {};
      var gameReceiver = namedLeader(team.receivers, 'targets', 3, ta.passes, tc.namedTargets, .7, .35);
      var gameRunner = runFocusFits && namedLeader(team.runners, 'carries', 4, ta.runs, tc.namedCarries, .75, .4);
      var gameChoices = [];
      if (gameReceiver) gameChoices.push({ role: 'receiver', player: gameReceiver, total: ta.passes,
        named: tc.namedTargets, ids: ta.passPlayIds, score: gameReceiver.targets / ta.passes, count: gameReceiver.targets });
      if (gameRunner) gameChoices.push({ role: 'runner', player: gameRunner, total: ta.runs,
        named: tc.namedCarries, ids: ta.runPlayIds, score: gameRunner.carries / ta.runs, count: gameRunner.carries });
      gameChoices.sort(function (a, b) { return b.score - a.score || b.count - a.count || a.role.localeCompare(b.role); });
      // The third-down focus already summarizes this receiver's narrower,
      // situation-specific evidence. Do not create a second card for the same
      // player from the broader game totals on that snap.
      if (gameChoices[0] && !(s.down === 3 && receiver)) {
        var gameChoice = gameChoices[0];
        add(playerCandidate(s, 'game', gameChoice.role, gameChoice.player, gameChoice.total, gameChoice.named,
          gameChoice.ids, 87 + Math.min(gameChoice.count, 3), 'game_player:' + off + ':' + gameChoice.role + ':' + gameChoice.player.name));
      }
    }
    if (d) {
      var dc = d.coverage || {}, da = d.actions || {}, driveChoices = [];
      var driveReceiver = namedLeader(d.receivers, 'targets', 2, da.passes, dc.namedTargets, 2 / 3, .5);
      var driveRunner = runFocusFits && namedLeader(d.runners, 'carries', 2, da.runs, dc.namedCarries, 2 / 3, .5);
      if (driveReceiver) driveChoices.push({ role: 'receiver', player: driveReceiver, total: da.passes,
        named: dc.namedTargets, ids: da.passPlayIds, score: driveReceiver.targets / da.passes, count: driveReceiver.targets });
      if (driveRunner) driveChoices.push({ role: 'runner', player: driveRunner, total: da.runs,
        named: dc.namedCarries, ids: da.runPlayIds, score: driveRunner.carries / da.runs, count: driveRunner.carries });
      driveChoices.sort(function (a, b) { return b.score - a.score || b.count - a.count || a.role.localeCompare(b.role); });
      if (driveChoices[0]) {
        var driveChoice = driveChoices[0];
        add(playerCandidate(s, 'drive', driveChoice.role, driveChoice.player, driveChoice.total, driveChoice.named,
          driveChoice.ids, 91 + Math.min(driveChoice.count, 2),
          'drive_player:' + off + ':' + d.id + ':' + driveChoice.role + ':' + driveChoice.player.name));
      }
    }
    if (d && d.sacks >= 2) {
      add(candidate('drive_sacks', 95, 'Two or more sacks have interrupted this drive.',
        'They have allowed ' + d.sacks + ' sacks on this possession. Another loss would leave more ground to make up.',
        'On a pass, watch whether the quarterback can step forward or has to leave the pocket.',
        { source: 'ESPN · released drive reports', playIds: d.playIds, lessonId: 'pocket_edges', key: 'drive_sacks:' + d.id }));
    }
    if (goal && s.down < 4) {
      add(candidate('goal_to_go', 65, 'The defense has less depth to protect here.',
        'With ' + s.yardsToGoal + ' yards to the end zone, there is less space behind the defenders for a receiver to use.',
        'Watch whether receivers separate across the field or toward the back of the end zone.', { lessonId: 'red_zone' }));
    } else if (s.down === 3) {
      add(candidate('third_down_distance', 60,
        s.distance >= 7 ? 'A completion can still leave them short.' : 'This is a chance to extend the possession.',
        'They need ' + s.distance + ' yards. A catch or first contact short of the line leaves the ball carrier with more work to do.',
        'Watch where the catch or first contact happens relative to the first-down line.',
        { lessonId: 'first_down_line', question: { kind: 'conversion', q: 'Will this play gain enough for a first down?' } }));
    } else if (s.down === 2 && s.distance >= 10) {
      add(candidate('second_long', 55, 'This play can make third down manageable—or leave a lot to do.',
        'They still need ' + s.distance + ' yards. A short gain leaves the next play needing most of that distance.',
        'On a catch, compare the yards from the throw with the yards gained afterward.', { lessonId: 'catch_and_run' }));
    }
    var historical = history.read(s, past);
    if (historical) add(candidate(historical.id, historical.priority, historical.headline, historical.detail, historical.watch, historical));
    var situational = list.filter(function (c) {
      return c.priority > 50 && ['long_thirds', 'goal_to_go', 'third_down_distance', 'second_long'].includes(c.id);
    });
    if (situational.length) {
      var aging = list.filter(function (c) {
        if (!['game_player', 'drive_player'].includes(c.id)) return false;
        var age = actionsSinceInvolvement(team, c.focus);
        return age !== null && age >= 2;
      }).sort(function (a, b) { return b.priority - a.priority || a.id.localeCompare(b.id); });
      if (aging.length) {
        var supporting = aging[0];
        // Keep the evidence visible in a smaller note. Do not pick a different
        // name simply for variety, or replace a player with an empty state.
        // A matched historical comparison can outrank the ordinary down cue.
        // It must retain the same workload note when that happens.
        var replacements = situational.concat(list.filter(function (c) { return c.historyRefs; }));
        replacements.forEach(function (c) {
          c.supportingPlayer = { name: supporting.focus.name, role: supporting.focus.role,
            detail: supporting.detail, source: supporting.source, playIds: supporting.playIds.slice(),
            sinceInvolvementPlayIds: team.playIds.slice(-2) };
          c.playIds = Array.from(new Set(c.playIds.concat(supporting.playIds, c.supportingPlayer.sinceInvolvementPlayIds)));
        });
        aging.forEach(function (c) { c.priority = 50; });
      }
    }
    return list.sort(function (a, b) { return b.priority - a.priority || a.id.localeCompare(b.id); });
  }
  function select(s, evidence, recent, past) {
    var list = candidates(s, evidence, past), seen = (recent || []).slice(-6);
    if (!list.length) return null;
    var previousKey = seen[seen.length - 1];
    var retained = list.find(function (c) { return c.key === previousKey && c.priority === list[0].priority; });
    // Keep an equally useful current read stable, whatever kind it is. A more
    // consequential drive pattern or decision can replace a player focus.
    // Recent display never disqualifies the best supported read.
    return retained || list[0];
  }
  var api = { version: VERSION, valid: valid, candidates: candidates, select: select };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FootballRead = api;
})(typeof window !== 'undefined' ? window : null);

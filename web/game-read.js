/* One evidence-backed read for the current situation. No network or DOM.
 * Input: approved pre-snap context, aggregates of released plays, and prior
 * selections. An observation never establishes the next formation or call. */
(function (root) {
  'use strict';
  var VERSION = 'read-1';
  function valid(s) {
    return s && Number.isInteger(s.down) && s.down >= 1 && s.down <= 4 &&
      Number.isInteger(s.distance) && s.distance >= 1 && Number.isInteger(s.yardsToGoal) &&
      s.yardsToGoal >= 1 && s.yardsToGoal <= 99 && s.distance <= s.yardsToGoal &&
      !((s.period === 2 || s.period === 4) && s.clockSeconds === 0);
  }
  function candidate(id, priority, headline, detail, watch, options) {
    return Object.assign({ id: id, version: VERSION, priority: priority, headline: headline,
      detail: detail, watch: watch || '', lessonId: null, question: null,
      source: 'Score, clock and field position', playIds: [], key: id }, options);
  }
  function candidates(s, evidence) {
    if (!valid(s)) return [];
    var list = [], goal = s.distance === s.yardsToGoal;
    var clockKnown = Number.isFinite(s.clockSeconds), scoreKnown = Number.isFinite(s.scoreDiff);
    var late = s.period === 4 && clockKnown && s.clockSeconds <= 300;
    var off = s.offenseTeam && String(s.offenseTeam.id || '');
    var e = evidence && evidence.gameId === String(s.gameId) ? evidence : null;
    var team = e && e.teams.find(function (t) { return t.teamId === off; });
    var d = e && e.drive && e.drive.teamId === off && !e.drive.complete ? e.drive : null;
    function add(c) { list.push(c); }
    if (s.down === 4) {
      var headline, detail, watch = 'Watch whether the offense stays on the field.', variant;
      if (late && scoreKnown && s.scoreDiff <= -4 && s.scoreDiff >= -8) {
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
        key: 'fourth_down:' + variant, question: { kind: 'gokick', q: 'Will they keep the offense out or bring on the kicking team?' }
      }));
    } else if (late && scoreKnown && s.scoreDiff < 0) {
      add(candidate('chasing_score', 89, 'They need points without using up this possession’s time.',
        'Down ' + Math.abs(s.scoreDiff) + ' with ' + Math.floor(s.clockSeconds / 60) + ':' + String(s.clockSeconds % 60).padStart(2, '0') +
        ' left. A short gain inbounds also uses clock unless it is stopped.',
        'After a catch, watch where the runner finishes relative to the sideline.', { lessonId: 'catch_and_run' }));
    }
    if (d && d.verified && d.playCount >= 2 && d.penaltyYards >= 10 && d.penaltyYards > Math.max(0, d.playYards)) {
      add(candidate('penalty_progress', 86, 'Flags have moved this drive farther than the offense’s plays.',
        'Penalties: ' + d.penaltyYards + ' yards forward. Plays: ' + (d.playYards < 0 ? Math.abs(d.playYards) + ' yards lost' : d.playYards + ' yards gained') + '.',
        '', { source: 'ESPN · released drive reports', playIds: d.playIds, key: 'penalty_progress:' + d.id + ':' + d.penaltyYards }));
    }
    if (team) {
      var t = team.thirdDowns;
      var receiver = t.receivers.slice().sort(function (a, b) { return b.targets - a.targets || a.name.localeCompare(b.name); })[0];
      if (s.down === 3 && receiver && receiver.targets >= 3 && t.namedTargets === t.throws && receiver.targets / t.throws >= 0.6) {
        add(candidate('third_down_target', 94, 'They keep looking for ' + receiver.name + ' on third down.',
          receiver.targets + ' of ' + t.throws + ' reported third-down throws have targeted him.',
          'Find him before the snap and watch where his defender lines up.',
          { source: 'ESPN · named targets this game', playIds: t.playIds,
            key: 'third_down_target:' + receiver.name + ':' + receiver.targets }));
      }
      if (t.attempts >= 4 && t.knownDistances === t.attempts && t.long >= 3 && t.long / t.attempts >= 0.6) {
        add(candidate('long_thirds', 75, 'Long third downs are making these possessions harder.',
          t.long + ' of ' + t.attempts + ' reported third-down plays needed at least seven yards.',
          s.down < 3 ? 'Watch how much the next play leaves them to gain.' : 'Watch where the catch happens relative to the first-down line.',
          { source: 'ESPN · third downs this game', playIds: t.playIds, lessonId: 'first_down_line',
            key: 'long_thirds:' + off + ':' + t.attempts }));
      }
    }
    if (d && d.sacks >= 2) {
      add(candidate('drive_sacks', 82, 'Two or more sacks have interrupted this drive.',
        'They have allowed ' + d.sacks + ' sacks on this possession. Another loss would leave more ground to make up.',
        'On a pass, watch whether the quarterback can step forward or has to leave the pocket.',
        { source: 'ESPN · released drive reports', playIds: d.playIds, lessonId: 'pocket_edges', key: 'drive_sacks:' + d.id + ':' + d.sacks }));
    }
    if (goal && s.down < 4) {
      add(candidate('goal_to_go', 65, 'The defense has less depth to protect here.',
        'With ' + s.yardsToGoal + ' yards to the end zone, there is less space behind the defenders for a receiver to use.',
        'Watch whether receivers separate across the field or toward the back of the end zone.', { lessonId: 'red_zone' }));
    } else if (s.down === 3) {
      add(candidate('third_down_distance', 60,
        s.distance >= 7 ? 'A completion can still leave them short.' : 'This is a chance to extend the possession.',
        'They need ' + s.distance + ' yards. Where the ball is caught matters as much as whether it is caught.',
        'Watch the receiver’s position relative to the first-down line.',
        { lessonId: 'first_down_line', question: { kind: 'conversion', q: 'Will this play gain enough for a first down?' } }));
    } else if (s.down === 2 && s.distance >= 10) {
      add(candidate('second_long', 55, 'This play can make third down manageable—or leave a lot to do.',
        'They still need ' + s.distance + ' yards. A short gain leaves the next play needing most of that distance.',
        'On a catch, compare the yards from the throw with the yards gained afterward.', { lessonId: 'catch_and_run' }));
    }
    return list.sort(function (a, b) { return b.priority - a.priority || a.id.localeCompare(b.id); });
  }
  function select(s, evidence, recent) {
    var list = candidates(s, evidence), seen = (recent || []).slice(-6);
    // Meaningful fourth-down decisions remain visible even if they recur.
    return list.find(function (c) { return c.priority >= 100 || seen.indexOf(c.key) < 0; }) || null;
  }
  var api = { version: VERSION, valid: valid, candidates: candidates, select: select };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FootballRead = api;
})(typeof window !== 'undefined' ? window : null);

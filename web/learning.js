/* Observation lessons are teaching examples, not descriptions of the live play.
 * The module has no DOM, feed, persistence, prediction, or grading side effects.
 * Background: operations.nfl.com/rules-officiating/nfl-football-basics/football-terms
 * and blogs.usafootball.com/blog/7133/implementing-motion-with-rpo-s . */
(function (root) {
  'use strict';

  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (key) { freeze(value[key]); });
      Object.freeze(value);
    }
    return value;
  }

  var lessons = [
    {
      id: 'motion', title: 'Follow the movement',
      watch: 'If someone moves across the formation before the snap, watch how the defense responds.',
      shortWatch: 'If someone moves before the snap, does a defender follow?',
      question: 'What changed when the player moved?',
      explanation: 'Motion gives the offense a new arrangement before the snap. A defender following the moving player can be a clue about coverage, but defenses can switch assignments or disguise their plan.',
      concepts: ['motion', 'receiver', 'snap', 'zone_coverage'],
      choices: [
        { id: 'followed', label: 'One defender followed', response: 'That can suggest a defender is assigned to that player. Watch whether the defender stays with him after the snap; the movement alone does not settle the coverage.' },
        { id: 'shifted', label: 'Several defenders shifted', response: 'The defense may be sharing or changing assignments as the offense moves. Follow one defender after the snap to see whether he follows a player or watches an area.' },
        { id: 'none', label: 'No one went in motion', response: 'Motion is optional. On a later play, watch for someone crossing behind the line before the ball is snapped.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'The camera often arrives after players have moved. Try watching one wide receiver before the next snap; there is no need to identify the whole defense.' }
      ],
      diagramLabel: 'Illustration of a receiver moving sideways before the snap and a defender moving across with him. This movement is a clue, not proof of a coverage.',
      diagramCaption: 'Example only. A defender follows the motion; the defense could still change after the snap.'
    },
    {
      id: 'handoff_fake', title: 'Keep your eye on the ball',
      watch: 'Watch the quarterback’s hands when a runner passes close by. Who leaves with the ball?',
      shortWatch: 'Watch the exchange. Who leaves with the ball?',
      question: 'What did you see at the exchange?',
      explanation: 'A handoff gives the ball to the runner. In play action, the quarterback sells a handoff before trying to pass. Keeping the ball alone does not prove there was a fake.',
      concepts: ['quarterback', 'play_action', 'snap'],
      choices: [
        { id: 'handoff', label: 'Runner took the ball', response: 'That looks like a handoff. Next time, glance at the defenders nearby: which one moves toward the runner first?' },
        { id: 'fake', label: 'Fake handoff, then a throw', response: 'You may have spotted play action. The fake is meant to draw attention toward a run; whether it fooled a defender takes another look.' },
        { id: 'kept', label: 'Quarterback kept it', response: 'The quarterback might run, pass, or keep an option open. Look for the handoff motion before calling it a fake.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'The exchange can be hidden by the players. A replay from behind the quarterback often gives a clearer view of the ball.' }
      ],
      diagramLabel: 'Illustration of a runner crossing beside the quarterback. Watch the point where their hands meet to see who keeps the ball.',
      diagramCaption: 'Example only. The paths show an exchange to watch, not a known handoff or fake.'
    },
    {
      id: 'deep_defenders', title: 'Look behind the defense',
      watch: 'Before the snap, look for the deepest defenders. Do they stay back or move forward?',
      shortWatch: 'Watch the deepest defenders before and after the snap.',
      question: 'What could you see at the back?',
      explanation: 'Deep defenders can help protect against long passes. Their starting positions show the space they could cover, but they may move into different jobs after the snap.',
      concepts: ['safety', 'snap', 'zone_coverage'],
      choices: [
        { id: 'one', label: 'One defender deep', response: 'One player deep in the middle can help over the top. That shape alone does not tell us whether the other defenders are following players or covering areas.' },
        { id: 'two', label: 'Two defenders deep', response: 'Two deep players can share the width of the field. Watch whether both stay back; one may move down as the play starts.' },
        { id: 'moved', label: 'They changed positions', response: 'That change is useful to notice. Defenses can show one arrangement before the snap and play another afterward.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'The deepest defenders are often outside the TV picture. Wait for a wider shot rather than guessing how many are back there.' }
      ],
      diagramLabel: 'Illustration with two defenders behind the other players, each in a shaded deep area. These starting positions do not identify the coverage.',
      diagramCaption: 'Example only. Two players start deep; their jobs after the snap may differ.'
    },
    {
      id: 'route_break', title: 'Follow one receiver',
      watch: 'Pick a receiver you can see. Watch the moment he changes direction, even if the ball goes elsewhere.',
      shortWatch: 'Follow one receiver. Watch his change of direction.',
      question: 'Which way did your receiver go?',
      explanation: 'A route is the path a receiver runs. A sharp change of direction is a break. Watching the defender at that moment can help you see whether the receiver creates space.',
      concepts: ['receiver', 'line_of_scrimmage'],
      choices: [
        { id: 'inside', label: 'Toward the middle', response: 'An inside break brings the receiver toward the middle of the field. Look at the space between him and the nearest defender before and after the turn.' },
        { id: 'outside', label: 'Toward the sideline', response: 'An outside break takes the receiver toward a sideline. Watch whether the defender turns with him or has to recover ground.' },
        { id: 'straight', label: 'No turn that I saw', response: 'Some routes keep going upfield, and some turns happen off camera. Following the straight part still helps you see how the receiver and defender move together.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'Try the receiver nearest the bottom of the TV picture next time. You only need to follow one player for a few seconds.' }
      ],
      diagramLabel: 'Illustration of a receiver running upfield, then turning toward the middle. A defender nearby shows the space to watch at the turn.',
      diagramCaption: 'Example only. One inside break is drawn; it is not the route from the live play.'
    },
    {
      id: 'screen_blockers', title: 'Watch who leads the way',
      watch: 'If a short pass goes near the line, look for blockers moving ahead of the receiver.',
      shortWatch: 'On a short pass, look for blockers ahead of the receiver.',
      question: 'What happened around the short pass?',
      explanation: 'A screen sets up a short pass with blockers leading the receiver. A short throw by itself is not enough to identify a screen; watch where the blockers go.',
      concepts: ['receiver', 'offensive_line', 'line_of_scrimmage'],
      choices: [
        { id: 'blockers', label: 'Blockers moved ahead', response: 'That may be a screen developing. Follow the first blocker and the defender he approaches; the useful detail is how space opens for the receiver.' },
        { id: 'none', label: 'No blockers ahead', response: 'It may simply have been a short pass, or the blockers may have been out of view. The distance of the throw alone does not identify the design.' },
        { id: 'other', label: 'There wasn’t a short pass', response: 'Save this for a play with a throw near the line. The clue is the blockers moving out to lead the receiver.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'Try looking away from the ball just after the catch. The players in front of the receiver can be easier to spot then.' }
      ],
      diagramLabel: 'Illustration of a short pass to a receiver with two blockers ahead. A dashed line shows the pass and solid arrows show the blockers moving upfield.',
      diagramCaption: 'Example only. This screen illustration shows the blockers to look for.'
    },
    {
      id: 'pocket_edges', title: 'Watch the space around the quarterback',
      watch: 'On a pass play, watch the blockers around the quarterback. Where does that space start to close?',
      shortWatch: 'On a pass play, watch where the pocket closes.',
      question: 'Where did pressure seem to come from?',
      explanation: 'The pocket is the space the blockers try to hold around the quarterback. Pressure can come around an edge or through the middle. A sack alone does not tell us who missed an assignment.',
      concepts: ['pocket', 'offensive_line', 'quarterback'],
      choices: [
        { id: 'edge', label: 'Around an outside edge', response: 'An edge rusher is working around the outside of the protection. Watch whether the quarterback can step forward; there may still be room inside.' },
        { id: 'middle', label: 'Through the middle', response: 'Pressure inside can close the space directly in front of the quarterback. It can come from a defender winning a block or arriving through a gap; the result alone does not tell us which.' },
        { id: 'room', label: 'The quarterback had room', response: 'The protection held visible space long enough for you to notice. Now compare that with how quickly the quarterback releases the ball.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'Start with the blocker at either end of the line. Watch that matchup for a moment instead of trying to follow every defender.' }
      ],
      diagramLabel: 'Illustration of blockers protecting a quarterback while a defender curves around one outside edge. The open space ahead of the quarterback is shaded.',
      diagramCaption: 'Example only. Pressure comes around the edge here; the live play may be different.'
    },
    {
      id: 'red_zone', title: 'Notice the shrinking space',
      watch: 'Near the end zone, watch how a receiver finds room with less field behind the defenders.',
      shortWatch: 'Near the end zone, watch how receivers find room.',
      question: 'How did the offense try to use the space?',
      explanation: 'The red zone is inside the opponent’s 20-yard line. As the offense gets closer, receivers have less room to run behind defenders before reaching the end line.',
      concepts: ['red_zone', 'receiver', 'quarterback'],
      choices: [
        { id: 'quick', label: 'A quick throw', response: 'A quick throw can use an opening before a defender closes it. Watch the receiver’s first few steps and when the ball leaves the quarterback’s hand.' },
        { id: 'wide', label: 'A throw toward the side', response: 'The offense may be using the width of the field. Look at the receiver’s space from both the defender and the boundary.' },
        { id: 'run', label: 'They ran the ball', response: 'On a run, look at the first gap the runner approaches. Notice whether it stays open or whether the runner changes direction.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'Try comparing the receiver’s space with a play farther from the end zone. The boundary behind the defense is part of what changes.' }
      ],
      diagramLabel: 'Illustration of a receiver turning sideways near the end zone. The end line limits the space behind the defenders.',
      diagramCaption: 'Example only. The end line leaves less room behind the defense.'
    },
    {
      id: 'first_down_line', title: 'Find the first-down marker',
      watch: 'If there’s a catch, compare the catch point with the first-down marker. Is there still ground to cover?',
      shortWatch: 'On a catch, is there still ground to the marker?',
      question: 'Where was the catch relative to the marker?',
      explanation: 'A completed pass can still leave the offense short. The receiver may need yards after the catch to reach the marker; the final spot decides the next down.',
      concepts: ['sticks', 'receiver', 'line_of_scrimmage'],
      choices: [
        { id: 'short', label: 'Before the marker', response: 'The receiver still had ground to cover. Watch what happens after the catch, then check the final spot rather than the catch point alone.' },
        { id: 'beyond', label: 'At or beyond the marker', response: 'The catch looked deep enough. Possession, forward progress and any penalty still affect the official result, so check the final spot.' },
        { id: 'none', label: 'No catch on this play', response: 'There may still have been receivers running toward the marker. On the next completed pass, compare the catch point with where the play ends.' },
        { id: 'unsure', label: 'Couldn’t tell', response: 'The yellow TV line is a useful guide, but it is not the official marker. The down and distance after the play can confirm whether the offense reached it.' }
      ],
      diagramLabel: 'Illustration of a catch before a dashed first-down marker, with an arrow showing the remaining ground to cover.',
      diagramCaption: 'Example only. The catch is short; the receiver still has ground to cover.'
    }
  ];
  freeze(lessons);

  function get(id) {
    return lessons.find(function (lesson) { return lesson.id === id; }) || null;
  }

  function choose(sit) {
    if (!sit || !Number.isInteger(sit.down) || sit.down < 1 || sit.down > 3 ||
        !Number.isInteger(sit.distance) || sit.distance < 1 ||
        !Number.isInteger(sit.yardsToGoal) || sit.yardsToGoal < 1 || sit.yardsToGoal > 99 ||
        sit.distance > sit.yardsToGoal) return null;
    if ((sit.period === 2 || sit.period === 4) && sit.clockSeconds === 0) return null;
    if (sit.yardsToGoal <= 10) return get('red_zone');
    var ids = sit.distance <= 3 ? ['motion', 'handoff_fake', 'first_down_line'] :
      sit.down === 3 && sit.distance >= 7 ? ['deep_defenders', 'route_break', 'pocket_edges', 'first_down_line'] :
      ['motion', 'handoff_fake', 'deep_defenders', 'route_break', 'screen_blockers', 'pocket_edges', 'first_down_line'];
    if (sit.yardsToGoal <= 20) ids = ids.concat('red_zone');
    if (sit.distance === sit.yardsToGoal) ids = ids.filter(function (id) { return id !== 'first_down_line'; });
    // Stable while only the clock changes. The input is context for a teaching
    // prompt, never evidence of the formation or what the next play will be.
    var period = Number.isInteger(sit.period) && sit.period > 0 ? sit.period : 0;
    return get(ids[(sit.down * 11 + sit.distance * 7 + sit.yardsToGoal + period * 3) % ids.length]);
  }

  function observationResponse(id, choiceId) {
    var lesson = get(id);
    var choice = lesson && lesson.choices.find(function (item) { return item.id === choiceId; });
    return choice ? choice.response : null;
  }

  // Accept the released FootballPlay.describe result, not arbitrary raw prose.
  // This selects a related topic, not a reconstruction or explanation of cause.
  function relatedToReport(report) {
    if (!report || report.voidReason && !/^Sack\./.test(report.summary || '')) return null;
    var facts = Array.isArray(report.facts) ? report.facts : [];
    var id = null, reason = '';
    if (/^Sack\.|^Quarterback scramble\b/.test(report.summary || '')) {
      id = 'pocket_edges'; reason = 'The report mentions a sack or scramble. This example shows where to look for pressure; it does not identify its cause on that play.';
    } else if (facts.some(function (fact) { return /^Deep pass(?: to the (?:left|right)| over the middle)?$/.test(fact); })) {
      id = 'deep_defenders'; reason = 'The report describes a deep pass. This example explains the defenders to watch; their coverage was not reported.';
    } else if (report.outcome === 'pass' && typeof report.need === 'number' && report.need > 0 &&
        typeof report.gained === 'number' && /^Pass complete\b/.test(report.summary || '')) {
      id = 'first_down_line';
      reason = typeof report.depthText === 'string' && report.depthText.trim() ?
        'The catch position is reported. This example explains the marker; it does not show the receiver’s actual route.' :
        'The report includes a completed pass and the yards needed. This example explains the marker; the report does not locate the catch itself.';
    }
    return id ? { lesson: get(id), reason: reason } : null;
  }

  function escape(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function label(x, y, text, extra) {
    return '<text class="learning-svg-label ' + (extra || '') + '" x="' + x + '" y="' + y + '">' + escape(text) + '</text>';
  }
  function player(x, y, text) {
    return '<circle class="learning-offense" cx="' + x + '" cy="' + y + '" r="10"/>' +
      (text ? label(x, y + 4, text, 'learning-player-label') : '');
  }
  function defender(x, y) {
    return '<path class="learning-defense" d="M' + (x - 7) + ' ' + (y - 7) + 'l14 14m0 -14l-14 14"/>';
  }
  function arrow(path, x, y, rotate, extra) {
    return '<path class="learning-route ' + (extra || '') + '" d="' + path + '"/>' +
      '<path class="learning-arrowhead ' + (extra || '') + '" d="M-5 7L0 0 5 7" transform="translate(' + x + ' ' + y + ') rotate(' + rotate + ')"/>';
  }
  function line() {
    return [200, 220, 240, 260, 280].map(function (x) { return player(x, 196); }).join('');
  }
  function diagramBody(id) {
    if (id === 'motion') return line() + player(240, 230, 'Q') + player(68, 212, 'R') + defender(80, 146) +
      arrow('M82 218 Q220 248 364 214', 364, 214, 65) +
      arrow('M94 146 H363', 363, 146, 90, 'learning-defender-path') +
      label(33, 83, 'Before the snap') + label(196, 131, 'Does a defender follow?');
    if (id === 'handoff_fake') return line() + player(240, 223, 'Q') + player(164, 229, 'R') +
      '<ellipse class="learning-highlight" cx="240" cy="232" rx="28" ry="20"/>' +
      arrow('M177 233 Q236 253 303 226', 303, 226, 62) +
      label(34, 85, 'Who keeps the ball?') +
      '<path class="learning-guide" d="M164 98 L227 209"/>';
    if (id === 'deep_defenders') return '<ellipse class="learning-zone" cx="140" cy="104" rx="78" ry="40"/>' +
      '<ellipse class="learning-zone" cx="340" cy="104" rx="78" ry="40"/>' + defender(140, 105) + defender(340, 105) +
      defender(185, 160) + defender(295, 160) + line() + player(240, 232, 'Q') +
      label(80, 70, 'Deep defenders') + label(237, 148, 'Space underneath', 'learning-svg-small');
    if (id === 'route_break') return line() + player(240, 231, 'Q') + player(75, 199, 'R') + defender(115, 139) +
      arrow('M75 186 V99 H195', 195, 99, 90) +
      '<circle class="learning-highlight" cx="75" cy="99" r="19"/>' +
      label(112, 77, 'The turn') + label(284, 113, 'Watch the space', 'learning-svg-small');
    if (id === 'screen_blockers') return player(235, 229, 'Q') + player(373, 205, 'R') +
      player(313, 168) + player(392, 147) + defender(345, 103) + defender(425, 92) +
      arrow('M249 226 L357 207', 357, 207, 80, 'learning-pass') +
      arrow('M314 154 L323 121', 323, 121, 15) + arrow('M392 134 V98', 392, 98, 0) +
      label(32, 83, 'Blockers lead the way') + label(140, 248, 'Short pass', 'learning-svg-small');
    if (id === 'pocket_edges') return '<path class="learning-zone" d="M187 197 Q182 237 240 253 Q298 237 293 197Z"/>' +
      line() + player(240, 230, 'Q') + defender(163, 162) +
      arrow('M152 166 Q128 227 202 239', 202, 239, 98, 'learning-defender-path') +
      arrow('M240 216 V177', 240, 177, 0) +
      label(33, 91, 'Pressure around the edge') + label(278, 235, 'Space to step into', 'learning-svg-small');
    if (id === 'red_zone') return '<rect class="learning-endzone" x="22" y="50" width="436" height="45" rx="4"/>' +
      label(240, 78, 'END ZONE', 'learning-centered') +
      '<path class="learning-boundary" d="M23 50H457"/>' + label(38, 120, 'Less room behind') +
      defender(320, 118) + line() + player(240, 232, 'Q') + player(374, 199, 'R') +
      arrow('M374 186 V130 H413', 413, 130, 90);
    return '<path class="learning-marker" d="M24 115H456"/>' + label(30, 102, 'First-down marker') +
      line() + player(240, 231, 'Q') + player(371, 157, 'R') +
      arrow('M253 225 L356 168', 356, 168, 58, 'learning-pass') +
      arrow('M371 143 V115', 371, 115, 0) + label(309, 88, 'Still to go', 'learning-svg-small');
  }

  function renderDiagram(id) {
    var lesson = get(id);
    if (!lesson) return '';
    // No IDs, external URLs, or raw data are interpolated, so repeated examples
    // on the same page cannot collide or inject markup.
    return '<svg class="learning-diagram" viewBox="0 0 480 300" role="img" aria-label="' + escape(lesson.diagramLabel) + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect class="learning-pitch" x="0" y="0" width="480" height="300" rx="14"/>' +
      label(22, 25, 'EXAMPLE ONLY', 'learning-svg-overline') + label(459, 25, 'Offense moves ↑', 'learning-right') +
      '<rect class="learning-field-bound" x="22" y="48" width="436" height="212" rx="5"/>' +
      [92, 136, 180, 224].map(function (y) { return '<path class="learning-yard-line" d="M23 ' + y + 'H457"/>'; }).join('') +
      '<path class="learning-scrimmage" d="M23 180H457"/>' +
      diagramBody(id) + player(34, 281) + label(52, 286, 'Offense', 'learning-svg-small') +
      defender(152, 281) + label(169, 286, 'Defense', 'learning-svg-small') +
      label(459, 286, 'Selected players shown', 'learning-right learning-svg-small') + '</svg>';
  }

  var api = freeze({ choose: choose, get: get, all: function () { return lessons; },
    observationResponse: observationResponse, relatedToReport: relatedToReport, renderDiagram: renderDiagram });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FootballLearning = api;
})(typeof window !== 'undefined' ? window : null);

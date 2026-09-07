(function (root) {
  'use strict';

  function number(value) { return typeof value === 'number' && Number.isFinite(value); }
  function teamId(block) { return block && block.team && String(block.team.id || ''); }
  function ordinal(down) { return ['', '1st', '2nd', '3rd', '4th'][down] || ''; }
  function yards(value) { return Math.abs(value) + ' yard' + (Math.abs(value) === 1 ? '' : 's'); }
  function gain(value) {
    if (!number(value)) return '';
    return value > 0 ? ' for ' + yards(value) : value < 0 ? ' for a loss of ' + yards(value) : ' for no gain';
  }

  function sentenceCase(value) {
    value = String(value || '').trim().toLowerCase();
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
  }

  function playerLabel(value, fallback) {
    value = String(value || '').replace(/^#\d{1,2}\s+/, '').trim();
    return value || fallback;
  }

  function advancedConsequence(result) {
    var value = result.consequence || '';
    if (/^Sack\./.test(result.summary)) value = value.replace(/^Loss of \d+ yards?\.\s*/, '');
    if (result.kind === 'score') {
      value = value.replace(/^(?:Six points(?: for the defense)?|Three points|Two points(?: to the defense)?|One point)\.\s*/, '');
    }
    return value;
  }

  function namedHurry(text) {
    var match = /\bQB hurried by\s+((?:#\d{1,2}\s+)?[A-Z][A-Za-z.\u2019\u0027-]*(?:\s+[A-Z][A-Za-z.\u2019\u0027-]*)?)(?=\s*(?:[,;(]|#\d|PENALTY\b|Original Play:|$))/i.exec(text);
    return match ? match[1].trim() : '';
  }

  // Accept one explicit ruling only. Multiple, declined and offsetting rulings
  // need the full report and should not be compressed into one penalty name.
  function singleAcceptedPenalty(text) {
    var parts = text.split(/\bPENALTY\s+/i).slice(1);
    if (parts.length !== 1 || /\bdeclined\b|\boffset(?:ting)?\b/i.test(text)) return '';
    var match = /^\s*\S+\s+(.+?)(?=\s+\(#|\s+\d+\s+(?:yards?|yds?)\b)/i.exec(parts[0]);
    if (!match || /\b(?:declined|offset(?:ting)?)\b/i.test(match[1])) return '';
    return sentenceCase(match[1].replace(/\s+/g, ' '));
  }

  // A touchdown and its conversion can share one ESPN row. A penalty on the
  // conversion must not erase the touchdown or describe its formation.
  function primaryText(raw) {
    var attempt = /\b(?:kick|pass|rush|run) attempt\b/i.exec(raw);
    return attempt && /\bTOUCHDOWN\b/i.test(raw.slice(0, attempt.index)) ? raw.slice(0, attempt.index) : raw;
  }

  function reportedFacts(text) {
    var out = [];
    if (/\bshotgun\b/i.test(text)) out.push('Shotgun');
    if (/\bno huddle\b/i.test(text)) out.push('No huddle');
    var pass = /\bpass (?:complete|incomplete) (short|deep)(?: (left|middle|right))?\b/i.exec(text);
    if (pass) {
      out.push((pass[1].toLowerCase() === 'short' ? 'Short' : 'Deep') + ' pass' +
        (pass[2] ? (pass[2].toLowerCase() === 'middle' ? ' over the middle' : ' to the ' + pass[2].toLowerCase()) : ''));
    } else {
      var run = /\brush (left|middle|right)\b/i.exec(text);
      if (run) out.push(run[1].toLowerCase() === 'middle' ? 'Run through the middle' : 'Run to the ' + run[1].toLowerCase());
    }
    return out;
  }

  // Keep the names ESPN actually reports. Jersey numbers and abbreviated names
  // are useful without a roster request; unmatched prose remains in `raw`.
  function reportedPlayers(text) {
    text = text.replace(/^\s*(?:\(\d{1,2}:\d{2}\)\s*)?(?:No Huddle(?:-Shotgun)?\s+|Shotgun\s+)?/i, '');
    var name = '((?:#\\d{1,2}\\s+)?[A-Z][A-Za-z.\u2019\u0027 -]{1,60}?)';
    var actor = new RegExp('^' + name + '\\s+(?:pass\\s+(?:complete|incomplete|intercepted)|rush|run|scramble|sacked)\\b').exec(text);
    if (!actor) return '';
    var receiver = new RegExp('\\bpass (?:complete|incomplete)(?: (?:short|deep))?(?: (?:left|middle|right))? to ' + name + '(?=\\s+(?:caught|thrown|for)\\b|,|$)').exec(text);
    return actor[1].trim() + (receiver ? ' to ' + receiver[1].trim() : '');
  }

  // End blocks occasionally mirror yardsToEndzone. Accept the known mirror
  // correction, but decline other contradictory spots rather than invent one.
  function yardsToGoal(block, abbr) {
    var ytg = block.yardsToEndzone;
    var spot = String(block.possessionText || '').trim();
    var parsed = /^(\S+)\s+(\d{1,2})$/.exec(spot), fromText = null;
    if (spot === '50') fromText = 50;
    if (parsed && Number(parsed[2]) <= 50) {
      var side = parsed[1].toUpperCase(), off = abbr[teamId(block)];
      if (off && side === off.toUpperCase()) fromText = 100 - Number(parsed[2]);
      else if (Object.keys(abbr).some(function (id) { return id !== teamId(block) && abbr[id].toUpperCase() === side; })) fromText = Number(parsed[2]);
    }
    if (fromText !== null) {
      if (!number(ytg) || ytg === 100 - fromText) ytg = fromText;
      else if (ytg !== fromText) return null;
    }
    return Number.isInteger(ytg) && ytg >= 1 && ytg <= 99 ? ytg : null;
  }

  function endSituation(p, abbr) {
    var end = p.end || {}, ytg = yardsToGoal(end, abbr);
    var spot = String(end.possessionText || '').trim();
    if (ytg === null) return '';
    var down = end.down, distance = end.distance;
    var goal = /\bgoal\b/i.test(end.shortDownDistanceText || end.downDistanceText || '');
    if (goal && distance === 0) distance = ytg;
    if (!(Number.isInteger(down) && down >= 1 && down <= 4 && Number.isInteger(distance) && distance >= 1 && distance <= ytg)) return '';
    if (goal && distance !== ytg) return '';
    var suffix = /^(?:\S+\s+\d{1,2}|50)$/.test(spot) ? ' at ' + spot : '';
    return ordinal(down) + ' & ' + (goal || distance === ytg ? 'goal' : distance) + suffix;
  }

  function possession(p, abbr) {
    var from = teamId(p.start), to = teamId(p.end);
    return from && to && from !== to && abbr[to] ? abbr[to] + ' takes possession.' : 'The other team takes possession.';
  }

  function conversion(p) {
    var attempt = p.pointAfterAttempt;
    if (!attempt) return '';
    var text = String(attempt.text || '').toLowerCase();
    if (attempt.value === 2) return ' Two-point conversion good.';
    if (attempt.value === 1) return ' Extra point good.';
    if (/two point|two-point/.test(text) && attempt.value === 0) return ' Two-point attempt unsuccessful.';
    if (/extra point/.test(text) && attempt.value === 0) return ' Extra point unsuccessful.';
    return '';
  }

  function kickResult(type, scoring, text) {
    // An explicit miss wins over a generic scoring-type label. In particular,
    // "No Good" contains "Good" and must never add points.
    if (/\b(?:no good|not good|missed|blocked|failed|unsuccessful)\b/i.test(type + ' ' + text)) return false;
    if (/\b(?:good|made|successful)\b/.test(type) || scoring === 'fieldgoal' || scoring === 'extrapoint') return true;
    return null;
  }

  function reportedYardage(text) {
    text = text.split(/\bPENALTY\b/i)[0];
    var loss = /\bfor (?:a )?loss of (\d+) (?:yards?|yds?)\b/i.exec(text);
    var amount = /\bfor (-?\d+) (?:yards?|yds?)(?: (gain|loss))?\b/i.exec(text);
    return loss ? -Number(loss[1]) : amount ? Number(amount[1]) * (amount[2] && amount[2].toLowerCase() === 'loss' ? -1 : 1) : /\bno gain\b/i.test(text) ? 0 : null;
  }

  function playYardage(p, abbr, text) {
    // Some live records leave statYardage at zero after the report and field
    // position have advanced. Replace it only when those two sources agree.
    var reported = reportedYardage(text);
    var stat = number(p.statYardage) ? p.statYardage : null;
    var start = p.start || {}, end = p.end || {}, movement = null;
    if (teamId(start) && teamId(start) === teamId(end)) {
      var from = yardsToGoal(start, abbr), to = yardsToGoal(end, abbr);
      if (to === null && end.yardsToEndzone === 0 && p.scoringPlay) to = 0;
      if (from !== null && to !== null) movement = from - to;
    }
    if (reported !== null && movement !== null && reported === movement) return { value: reported, conflict: false };
    if (reported !== null && stat !== null && reported === stat) return { value: reported, conflict: movement !== null && movement !== reported };
    if (reported !== null && stat === null && movement === null) return { value: reported, conflict: false };
    if (reported === null && stat !== null && (movement === null || movement === stat)) return { value: stat, conflict: false };
    if (reported === null && stat === null) return { value: null, conflict: false };
    return { value: null, conflict: true };
  }

  function describeBase(p, abbr) {
    p = p || {}; abbr = abbr || {};
    var type = String((p.type || {}).text || '').toLowerCase();
    var raw = String(p.text || ''), primary = primaryText(raw).split(/\bOriginal Play:/i)[0];
    var scoring = String((p.scoringType || {}).name || '').toLowerCase().replace(/[^a-z]/g, '');
    var result = { summary: '', consequence: '', facts: [], players: '', kind: '', raw: raw,
      outcome: 'other', voidReason: null, turnover: false, clockPlay: false, gained: null, need: null };
    var y = number(p.statYardage) ? p.statYardage : null;
    var penaltyParts = primary.split(/\bPENALTY\b/i).slice(1);
    var acceptedPenalty = penaltyParts.some(function (part) { return !/\bdeclined\b/i.test(part); });
    var wiped = /\bnullified\b|\bno play\b/i.test(primary);
    var declinedPlay = penaltyParts.length && !acceptedPenalty && !wiped &&
      /\b(?:sacked|rush|run|scrambl(?:e|es|ed)|pass (?:complete|incomplete|intercepted)|punt|kickoff)\b/i.test(primary.split(/\bPENALTY\b/i)[0]);
    var next = endSituation(p, abbr);

    if (/timeout|^end |^end of|^two.minute|official|coin toss/.test(type)) {
      result.summary = (p.type && p.type.text) || 'Game pause.';
      result.voidReason = 'No play took place. Your pick does not count.';
      return result;
    }
    if (wiped || ((p.isPenalty || type.indexOf('penalt') >= 0) && !declinedPlay) || acceptedPenalty) {
      result.summary = /touchdown\s+nullified/i.test(primary) ? 'Touchdown called back by a penalty.' :
        wiped ? (/^\s*PENALTY\b/i.test(primary) ? 'Penalty. No play.' : 'Play called back by a penalty.') : acceptedPenalty || p.isPenalty ? 'Penalty on the play.' : 'Penalty declined.';
      result.consequence = 'See the play report for the ruling.';
      result.voidReason = 'A penalty affected this play, so your pick does not count.';
      return result;
    }
    if (/\bkneel(?:s|ed|ing)?\b|\btakes? a knee\b/i.test(primary) && !/\bfake(?:s|d)? kneel\b/i.test(primary)) {
      result.clockPlay = true;
      result.summary = 'Took a knee.';
      result.consequence = next ? 'Next: ' + next + '.' : '';
      result.voidReason = 'The offense took a knee. Your pick does not count.';
      return result;
    }
    if (/\bspike[ds]?\b/i.test(primary) || type.indexOf('spike') >= 0) {
      result.clockPlay = true;
      result.summary = 'Spike to stop the clock.';
      result.consequence = next ? 'Next: ' + next + '.' : '';
      result.voidReason = 'The quarterback spiked the ball to stop the clock. Your pick does not count.';
      return result;
    }

    result.facts = reportedFacts(primary);
    result.players = reportedPlayers(primary);
    if (penaltyParts.length) result.facts = result.facts.concat('Penalty declined').slice(-3);

    var touchdown = type.indexOf('touchdown') >= 0 || scoring === 'touchdown' ||
      (p.scoringPlay === true && /\bTOUCHDOWN\b/.test(primary));
    var interception = type.indexOf('interception') >= 0 || /\bintercepted\b/i.test(primary);
    var fumble = type.indexOf('fumble') >= 0 || /\bfumbled\b/i.test(primary);
    var sack = type.indexOf('sack') >= 0 || /\bsacked\b/i.test(primary);
    var scramble = type.indexOf('scramble') >= 0 || /\bscrambl(?:e|es|ed|ing)\b/i.test(primary);
    var kick = /kick|punt|field goal|extra point/.test(type) || scoring === 'fieldgoal';
    var pass = /pass|reception/.test(type) || /\bpass (?:complete|incomplete|intercepted)\b/i.test(primary);
    var run = /rush|run/.test(type) || /\b(?:rush|run)\b/i.test(primary);
    result.outcome = kick ? 'kick' : sack ? 'other' : scramble ? 'run' : pass || interception ? 'pass' : run ? 'run' : 'other';
    if (sack) result.voidReason = 'The quarterback was sacked before throwing. Your pick does not count.';
    result.turnover = !!p.isTurnover || interception || /TURNOVER ON DOWNS/i.test(primary) ||
      (fumble && ((teamId(p.start) && teamId(p.end) && teamId(p.start) !== teamId(p.end)) || /opponent/.test(type)));
    var yardageConflict = false;
    if (!kick && !interception && !fumble && (pass || run || sack || scramble)) {
      var checked = playYardage(p, abbr, primary);
      y = checked.value; yardageConflict = checked.conflict;
      if (yardageConflict) {
        next = '';
        result.voidReason = 'The reported yardage is inconsistent, so your pick does not count.';
      }
      // A declined penalty can leave the down unadvanced in ESPN's end block.
      // Keep the reported action, but do not print that impossible next down.
      var before = p.start || {}, after = p.end || {};
      var distance = before.distance || yardsToGoal(before, abbr);
      if (next && !touchdown && !result.turnover && y !== null && distance > 0 && before.down >= 1 && before.down <= 4 &&
          after.down !== (y >= distance ? 1 : before.down + 1)) next = '';
    }

    if (interception) {
      result.summary = touchdown ? 'Interception returned for a touchdown.' : 'Intercepted. A defender caught the pass.';
      result.kind = touchdown ? 'score' : 'turn';
      result.consequence = touchdown ? 'Six points for the defense.' + conversion(p) : possession(p, abbr);
    } else if (sack && !fumble && !touchdown && scoring !== 'safety') {
      result.summary = 'Sack. The quarterback was tackled before throwing.';
      result.consequence = y !== null && y < 0 ? 'Loss of ' + yards(y) + '.' : '';
      if (next && !result.turnover) result.consequence += (result.consequence ? ' ' : '') + 'Next: ' + next + '.';
    } else if (touchdown) {
      if (kick) result.summary = /block/.test(type) ? 'Touchdown after a blocked kick.' : (type.indexOf('punt') >= 0 ? 'Punt' : 'Kickoff') + ' returned for a touchdown.';
      else if (fumble) result.summary = 'Fumble recovered for a touchdown.';
      else result.summary = y !== null && y > 0 ? y + '-yard touchdown ' + (result.outcome === 'pass' ? 'pass.' : result.outcome === 'run' ? 'run.' : 'play.') : 'Touchdown.';
      result.kind = 'score';
      result.consequence = 'Six points.' + conversion(p);
    } else if (fumble) {
      var retained = /\bown\b/.test(type) || (teamId(p.start) && teamId(p.end) && teamId(p.start) === teamId(p.end));
      result.summary = result.turnover ? 'Fumble. The other team recovered the ball.' : retained ? 'Fumble. The offense recovered the ball.' : 'Fumble reported.';
      result.kind = result.turnover ? 'turn' : '';
      result.consequence = result.turnover ? possession(p, abbr) : next ? 'Next: ' + next + '.' : '';
    } else if (type.indexOf('field goal') >= 0 || scoring === 'fieldgoal') {
      var good = kickResult(type, scoring, primary);
      result.summary = good ? 'Field goal good.' : good === null ? 'Field goal attempt.' : /block/i.test(type + ' ' + primary) ? 'Field goal blocked.' : 'Field goal missed.';
      result.kind = good ? 'score' : '';
      result.consequence = good ? 'Three points.' : '';
    } else if (type.indexOf('extra point') >= 0 || scoring === 'extrapoint') {
      var extraGood = kickResult(type, scoring, primary);
      result.summary = extraGood ? 'Extra point good.' : extraGood === null ? 'Extra point attempt.' : 'Extra point unsuccessful.';
      result.kind = extraGood ? 'score' : '';
      result.consequence = extraGood ? 'One point.' : '';
    } else if (type.indexOf('safety') >= 0 || scoring === 'safety') {
      result.summary = 'Safety.';
      result.kind = 'score';
      result.consequence = 'Two points to the defense.';
      result.outcome = 'other';
      result.voidReason = 'This play ended in a safety. Your pick does not count.';
    } else if (/two.point/.test(type) || scoring.indexOf('twopoint') === 0) {
      var twoGood = p.scoreValue === 2 || (p.scoringPlay === true && p.scoreValue !== 0);
      result.summary = twoGood ? 'Two-point conversion good.' : 'Two-point conversion attempt.';
      result.kind = twoGood ? 'score' : '';
      result.consequence = twoGood ? 'Two points.' : '';
      result.outcome = 'other';
      result.voidReason = 'That was a two-point attempt. Your pick does not count.';
    } else if (kick) {
      result.summary = type.indexOf('punt') >= 0 ? 'Punt.' : 'Kickoff.';
      result.consequence = teamId(p.start) && teamId(p.end) && teamId(p.start) !== teamId(p.end) ? possession(p, abbr) : '';
    } else if (scramble) {
      result.summary = 'Quarterback scramble' + gain(y) + '.';
    } else if (result.outcome === 'pass') {
      result.summary = /incomplet/.test(type) || /\bpass incomplete\b/i.test(primary) ? 'Incomplete pass.' :
        /reception/.test(type) || /\bpass complete\b/i.test(primary) ? 'Pass complete' + gain(y) + '.' : 'Pass play.';
    } else if (result.outcome === 'run') {
      result.summary = 'Run' + gain(y) + '.';
    } else {
      result.summary = (p.type && p.type.text) || 'Play report available.';
      result.voidReason = 'The play report is unclear, so your pick does not count.';
    }

    // Fourth-down failure is a possession change even when isTurnover=false.
    // Return yardage on interceptions is never a measure of offensive progress.
    var start = p.start || {}, changed = teamId(start) && teamId(p.end) && teamId(start) !== teamId(p.end);
    var fourthDownFailure = start.down === 4 && !kick && !interception && !fumble && !touchdown &&
      (changed || /TURNOVER ON DOWNS/i.test(primary));
    if (fourthDownFailure) {
      result.turnover = true; result.kind = 'turn';
      result.consequence = 'Turnover on downs. ' + possession(p, abbr);
    } else if (!result.consequence && !touchdown && !kick && !result.turnover && next) {
      result.consequence = 'Next: ' + next + '.';
    }
    if (result.turnover && !result.consequence) {
      result.kind = 'turn';
      result.consequence = possession(p, abbr);
    }
    if (yardageConflict && result.kind !== 'score' && !result.turnover) result.consequence = 'ESPN reports conflicting yardage. See the play report.';
    if (!result.voidReason && result.outcome === 'other') result.voidReason = 'The play report is unclear, so your pick does not count.';
    if (!result.voidReason && !result.turnover && (result.outcome === 'pass' || result.outcome === 'run')) {
      result.gained = y;
      var need = start.distance === 0 ? yardsToGoal(start, abbr) : start.distance;
      result.need = Number.isInteger(need) && need >= 1 ? need : null;
    }
    return result;
  }

  function validatedMovement(p, abbr, result, text) {
    var start = p.start || {}, end = p.end || {};
    if (!teamId(start) || teamId(start) !== teamId(end) || result.turnover || result.outcome === 'kick') return null;
    var from = yardsToGoal(start, abbr), to = yardsToGoal(end, abbr);
    if (to === null && end.yardsToEndzone === 0 && result.kind === 'score') to = 0;
    if (from === null || to === null) return null;
    var net = from - to;
    var penalties = text.split(/\bPENALTY\s+/i).slice(1).filter(function (clause) { return !/\bdeclined\b/i.test(clause); });
    if (penalties.length) {
      if (penalties.length !== 1 || /\bnullified\b|\boffset/i.test(text)) return null;
      var enforced = /\b(\d+) yards? from\b/i.exec(penalties[0]);
      if (!enforced) return null;
      var playGain = /\bNO PLAY\b/i.test(text) || /^\s*PENALTY\b/i.test(text) ? 0 : reportedYardage(text);
      if (playGain === null) return null;
      if (from - playGain < 0 || from - playGain > 100) return null;
      var penaltyGain = net - playGain;
      if (Math.abs(penaltyGain) !== Number(enforced[1])) return null;
      return { start: from, end: to, net: net, play: playGain, penalty: penaltyGain };
    }
    if (result.gained !== null && result.gained === net) return { start: from, end: to, net: net, play: net, penalty: 0 };
    if (result.clockPlay || /\bsacked\b/i.test(text)) {
      var checked = playYardage(p, abbr, text);
      if (!checked.conflict && checked.value === net) return { start: from, end: to, net: net, play: net, penalty: 0 };
    }
    return null;
  }

  function catchPosition(text, p, abbr, movement) {
    if (/\bcaught at 50\b/i.test(text)) return 50;
    var caught = /\bcaught at ([A-Za-z]+)\s*(\d{1,2})(?=[\s,.)]|$)/i.exec(text);
    if (!caught || Number(caught[2]) > 50) return null;
    var n = Number(caught[2]), side = caught[1].toUpperCase();
    if (n === 50) return 50;
    var off = teamId(p.start), offAbbr = abbr[off];
    if (offAbbr && side === offAbbr.toUpperCase()) return 100 - n;
    if (Object.keys(abbr).some(function (id) { return id !== off && abbr[id].toUpperCase() === side; })) return n;
    // ESPN prose often uses OhioSt where its structured spot uses OSU. Resolve
    // that alias only when the same prose end spot matches the validated end.
    var end = /\bfor -?\d+ (?:yards?|yds?)(?: (?:gain|loss))? to (?:the )?([A-Za-z]+)\s*(\d{1,2})(?=[\s,.)]|$)/i.exec(text);
    if (!end || side !== end[1].toUpperCase() || movement.end === 50) return null;
    if (Number(end[2]) !== Math.min(movement.end, 100 - movement.end)) return null;
    return movement.end > 50 ? 100 - n : n;
  }

  function describe(p, abbr) {
    p = p || {}; abbr = abbr || {};
    var result = describeBase(p, abbr), text = primaryText(result.raw).split(/\bOriginal Play:/i)[0];
    result.meaning = ''; result.airYards = null; result.yardsAfterCatch = null;
    result.depthText = ''; result.depthSource = null;
    result.takeaway = ''; result.provenance = null;
    result.gameSummary = result.summary; result.gameConsequence = '';
    result.startYardsToGoal = yardsToGoal(p.start || {}, abbr);
    result.movement = validatedMovement(p, abbr, result, text);
    result.people = { passer: '', receiver: '', runner: '' };
    var names = result.players.split(' to ');
    if (result.outcome === 'pass' || /\bsacked\b/i.test(text)) {
      result.people.passer = names[0]; result.people.receiver = names[1] || '';
    } else if (result.outcome === 'run') result.people.runner = names[0];

    var movement = result.movement;
    if (movement && movement.penalty) {
      var direction = movement.penalty > 0 ? 'forward' : 'back';
      result.consequence = movement.play ?
        (movement.play > 0 ? yards(movement.play) + ' gained on the play' : yards(movement.play) + ' lost on the play') + ', then ' + yards(movement.penalty) + ' ' + direction + ' for the penalty.' :
        'The penalty moved the ball ' + yards(movement.penalty) + ' ' + direction + '.';
      var next = endSituation(p, abbr);
      if (/\bNO PLAY\b/i.test(text) && !/\b1ST DOWN\b/i.test(text) && (p.start || {}).down !== (p.end || {}).down) next = '';
      if (/\b1ST DOWN\b/i.test(text) && (p.end || {}).down !== 1) next = '';
      if (next) result.consequence += ' Next: ' + next + '.';
      else if (/\b1ST DOWN\b/i.test(text)) result.consequence += ' First down.';
      if (/\bNO PLAY\b/i.test(text)) result.meaning = 'The penalty changed the spot. The play itself does not count.';
    } else if (result.gained !== null && result.need !== null && result.kind !== 'score') {
      var goal = /\bgoal\b/i.test((p.start || {}).shortDownDistanceText || (p.start || {}).downDistanceText || '') ||
        (p.start || {}).distance === 0 || result.startYardsToGoal === result.need;
      if (goal && movement) result.meaning = 'The ball is now ' + yards(movement.end) + ' from the end zone.';
      else if (result.gained >= result.need) result.meaning = 'They reached the first-down line and earned a new set of downs.';
      else if (result.gained >= 0) result.meaning = 'They gained ' + result.gained + ' of the ' + result.need + ' yards needed for a first down.';
      else result.meaning = 'Losing ' + yards(result.gained) + ' leaves ' + (result.need - result.gained) + ' yards to the first-down line.';
    }

    var complete = !/\b(?:incomplete|intercepted)\b/i.test(text) &&
      (/\bpass complete\b/i.test(text) || /reception/i.test((p.type || {}).text || '') || p.complete_pass === 1);
    if (complete && result.outcome === 'pass' && result.gained !== null && !result.turnover && !result.voidReason) {
      // Known enriched CFBD and nflverse field spellings, never a number inferred
      // from the words "short" or "deep".
      var air = p.airYards !== undefined ? p.airYards : p.air_yards;
      var after = p.yardsAfterCatch !== undefined ? p.yardsAfterCatch : p.yards_after_catch;
      var source = null;
      var caught = movement && movement.penalty === 0 ? catchPosition(text, p, abbr, movement) : null;
      if (Number.isInteger(air) && Number.isInteger(after) && Math.abs(air) <= 99 && Math.abs(after) <= 99 && air + after === result.gained) {
        if (caught === null || (air === movement.start - caught && after === caught - movement.end)) source = 'reported';
      } else if (air == null && after == null && caught !== null) {
        air = movement.start - caught; after = caught - movement.end; source = 'reported spots';
      }
      if (source) {
        result.airYards = air; result.yardsAfterCatch = after; result.depthSource = source;
        result.depthText = air === 0 ? 'Caught at the line of scrimmage' : 'Caught ' + yards(air) + (air > 0 ? ' beyond' : ' behind') + ' the line of scrimmage';
        result.depthText += after >= 0 ? '; ' + yards(after) + ' after the catch.' : '; then lost ' + yards(after) + '.';
      }
    }

    var penaltyName = result.movement && result.movement.penalty ? singleAcceptedPenalty(text) : '';
    var hurry = namedHurry(text);
    var remaining = result.gained !== null && result.need !== null ? result.need - result.gained : null;
    var missedKick = /\bfield goal attempt from (\d+) yards?\s+(?:NO GOOD|MISSED)\b/i.exec(text);
    var end = p.end || {}, endSpot = String(end.possessionText || '').trim();

    if (penaltyName) {
      if (/^Roughing the kicker$/i.test(penaltyName) && missedKick && /\bNO PLAY\b/i.test(text) &&
          /\b1ST DOWN\b/i.test(text) && end.down === 1 && /^(?:\S+\s+\d{1,2}|50)$/.test(endSpot)) {
        result.takeaway = 'The missed ' + missedKick[1] + '-yard field goal did not end the drive: a ' + Math.abs(movement.penalty) +
          '-yard penalty for roughing the kicker gave the offense a first down at ' + endSpot + '.';
      } else {
        var ruling = result.consequence.replace(/^The penalty/, penaltyName);
        result.takeaway = ruling === result.consequence ? penaltyName + ': ' +
          ruling.charAt(0).toLowerCase() + ruling.slice(1) : ruling;
      }
      result.provenance = 'ESPN ruling; yardage checked against the reported field positions.';
      result.gameSummary = 'Penalty: ' + penaltyName.toLowerCase() + '.';
    } else if (hurry && !result.voidReason) {
      result.takeaway = 'The play report credits ' + hurry + ' with a quarterback hurry.';
      result.provenance = 'Quarterback hurry attributed by the play report.';
    } else if (result.movement && result.movement.penalty === 0 && result.gained > 0 &&
        result.need >= 15 && remaining >= 10) {
      var carrier = result.outcome === 'pass' ? result.people.receiver : result.people.runner;
      result.takeaway = playerLabel(carrier, 'The offense') + ' gained ' + yards(result.gained) + ', still leaving ' + yards(remaining) + ' to the first-down line.';
      result.provenance = 'Calculated from the reported down, distance, gain, and end position.';
    } else if (result.depthText && result.kind !== 'score') {
      var catchPoint = result.airYards === 0 ? 'at the line of scrimmage' :
        yards(result.airYards) + (result.airYards > 0 ? ' beyond' : ' behind') + ' the line of scrimmage';
      var afterCatch = result.yardsAfterCatch >= 0 ? 'gained ' + yards(result.yardsAfterCatch) + ' after the catch' :
        'lost ' + yards(result.yardsAfterCatch) + ' after the catch';
      result.takeaway = playerLabel(result.people.receiver, 'The receiver') + ' caught it ' + catchPoint + ', then ' + afterCatch + ': ' + yards(result.gained) + ' overall.';
      result.provenance = result.depthSource === 'reported spots' ?
        'Calculated from the start, catch, and end positions in the play report.' :
        'Passing distances supplied by the play report and reconciled with the total gain.';
    }

    if (/^Sack\./.test(result.summary)) {
      result.gameSummary = result.movement && result.movement.play < 0 ?
        'Sack for a loss of ' + yards(result.movement.play) + '.' : 'Sack.';
    } else if (/^Intercepted\./.test(result.summary)) {
      result.gameSummary = 'Interception.';
    }
    // A validated penalty takeaway already includes the movement and ruling.
    result.gameConsequence = penaltyName ? '' : advancedConsequence(result);
    return result;
  }

  var api = { describe: describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FootballPlay = api;
})(typeof window !== 'undefined' ? window : null);

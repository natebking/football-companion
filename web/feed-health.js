(function (root) {
  'use strict';

  function clockKey(period, value) {
    var match = /^(\d{1,2}):([0-5]\d)$/.exec(String(value || ''));
    if (!Number.isInteger(period) || period < 1 || period > 4 || !match || Number(match[1]) > 15) return '';
    return period + '|' + Number(match[1]) + ':' + match[2];
  }

  function playClockKey(play) {
    return clockKey(Number((play.period || {}).number), (play.clock || {}).displayValue);
  }

  function isScrimmage(play) {
    var type = String((play.type || {}).text || '').toLowerCase();
    var text = String(play.text || '');
    // A touchdown can include a conversion penalty in the same source row.
    var attempt = /\b(?:kick|pass|rush|run) attempt\b/i.exec(text);
    if (attempt && /\bTOUCHDOWN\b/i.test(text.slice(0, attempt.index))) text = text.slice(0, attempt.index);
    if (play.isPenalty || /timeout|^end |^end of|official|coin toss|kick|punt|field goal|extra point|two.point|penalt/.test(type)) return false;
    if (/\bkneel|\bspike[ds]?\b|\bno play\b|\bPENALTY\b/i.test(text)) return false;
    if (/fumble/.test(type) && /\bpunt\b|\bkickoff\b/i.test(text)) return false;
    return /rush|run|pass|reception|incomplet|sack|scrambl|interception|fumble/.test(type);
  }

  function inspectClocks(plays, status) {
    status = status || {};
    var reportedClock = String(status.displayClock || '');
    var period = Number(status.period) || 0;
    var headerKey = clockKey(period, reportedClock);
    // A corrected copy of an ID replaces its earlier version and never counts
    // as another snap. Input order is the feed's existing chronological order.
    var byId = new Map();
    (plays || []).forEach(function (play) {
      if (play && play.id !== undefined && play.id !== null) byId.set(String(play.id), play);
    });
    var rows = Array.from(byId.values()), groups = [], latest = null;
    rows.forEach(function (play) {
      if (!isScrimmage(play)) return;
      var key = playClockKey(play);
      if (!key) { latest = null; return; }
      if (!latest || latest.key !== key) {
        latest = { key: key, count: 0 };
        groups.push(latest);
      }
      latest.count += 1;
    });
    var unreliableKeys = new Set(groups.filter(function (group) { return group.count >= 3; }).map(function (group) { return group.key; }));
    var unreliableIds = rows.filter(function (play) { return unreliableKeys.has(playClockKey(play)); }).map(function (play) { return String(play.id); });
    var repeatedCount = latest && latest.key === headerKey ? latest.count : 0;
    var finished = (status.type || {}).completed || (status.type || {}).state === 'post';
    return {
      stalled: !finished && repeatedCount >= 3,
      repeatedCount: repeatedCount,
      unreliableIds: unreliableIds,
      reportedClock: reportedClock,
      period: period
    };
  }

  var api = { inspectClocks: inspectClocks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FootballFeed = api;
})(typeof window !== 'undefined' ? window : null);

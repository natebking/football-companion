/* Identity labels only. Never changes analysis keys, counts or source reports. */
(function (root) {
  'use strict';
  function labels(names, teamId, resolve) {
    return Array.from(new Set(names.filter(Boolean))).map(function (name) {
      return resolve(String(teamId || ''), name);
    }).filter(Boolean);
  }
  function text(line, identities, names) {
    if (!line || !identities.length) return line;
    var replacements = new Map();
    var unmatched = (names || []).filter(function (name) { return name && !identities.some(function (item) { return item.reportedName === name; }); })
      .map(function (name) { return { reportedName: name, label: name, unresolved: true }; });
    identities.concat(unmatched).forEach(function (item) {
      [item.reportedName, item.reportedName.replace(/^#\d{1,2}\s+/, '')].forEach(function (alias) {
        var label = item.unresolved ? alias : item.label;
        // Do not expand a numberless alias when two reported players share it.
        if (replacements.has(alias) && replacements.get(alias) !== label) replacements.set(alias, null);
        else if (!replacements.has(alias)) replacements.set(alias, label);
      });
    });
    var aliases = Array.from(replacements.keys()).filter(function (alias) { return alias && replacements.get(alias); })
      .sort(function (a, b) { return b.length - a.length; });
    if (!aliases.length) return line;
    var pattern = aliases.map(function (alias) { return alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|');
    return line.replace(new RegExp('(^|[^\\p{L}\\p{N}#])(' + pattern + ')(?![\\p{L}\\p{N}])', 'gu'), function (matched, before, alias, offset, source) {
      if (alias.charAt(0) !== '#' && /#\d{1,2}\s+$/.test(source.slice(0, offset + before.length))) return matched;
      return before + replacements.get(alias);
    });
  }
  function read(value, teamId, resolve) {
    var names = value ? [value.focus && value.focus.name, value.supportingPlayer && value.supportingPlayer.name] : [];
    var ids = labels(names, teamId, resolve);
    return { headline: text(value ? value.headline : '', ids, names), detail: text(value ? value.detail : '', ids, names),
      watch: text(value ? value.watch : '', ids, names),
      playerContext: value && value.supportingPlayer ? 'Player workload · ' + text(value.supportingPlayer.detail, ids, names) : '',
      identities: ids };
  }
  function play(value, resolve) {
    var names = Object.values(value.people || {}), ids = labels(names, value.teamId, resolve);
    return { players: text(value.players, ids, names), takeaway: text(value.takeaway, ids, names), identities: ids };
  }
  function insights(value, resolve) {
    return Object.assign({}, value, { teams: (Array.isArray(value.teams) ? value.teams : Object.values(value.teams || {})).map(function (team) {
      var names = (team.runners || []).concat(team.receivers || []).map(function (p) { return p.name; });
      var ids = labels(names, team.teamId, resolve);
      return Object.assign({}, team, { summaries: (team.summaries || []).map(function (line) { return text(line, ids, names); }) });
    }) });
  }
  var api = { labels: labels, text: text, read: read, play: play, insights: insights };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FootballPlayerDisplay = api;
})(typeof window !== 'undefined' ? window : globalThis);

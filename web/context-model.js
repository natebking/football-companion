/* Pure reader for evaluated score/clock tables. Not wired into live estimates.
 * The input carries only pre-snap fields. Null means no supported context. */
(function (root) {
  'use strict';
  function keys(s) {
    if (!s || !Number.isInteger(s.down) || s.down < 1 || s.down > 4 ||
        !Number.isInteger(s.distance) || s.distance < 1 || s.distance > 99 ||
        !Number.isInteger(s.yardsToGoal) || s.yardsToGoal < 1 || s.yardsToGoal > 99 ||
        !Number.isInteger(s.period) || s.period < 1 || s.period > 10 ||
        !Number.isInteger(s.clockSeconds) || s.clockSeconds < 0 || s.clockSeconds > 900 ||
        !Number.isInteger(s.scoreDiff) || Math.abs(s.scoreDiff) > 99) return null;
    var band = s.distance <= 3 ? 'short' : s.distance <= 7 ? 'medium' : 'long';
    var zone = s.yardsToGoal >= 80 ? 'own_deep' : s.yardsToGoal >= 60 ? 'own' :
      s.yardsToGoal >= 40 ? 'mid' : s.yardsToGoal >= 20 ? 'opp' : 'red';
    var score = s.scoreDiff <= -9 ? 'behind_9plus' : s.scoreDiff < 0 ? 'behind_1to8' :
      s.scoreDiff === 0 ? 'tied' : s.scoreDiff <= 8 ? 'ahead_1to8' : 'ahead_9plus';
    var phase = s.period > 4 ? 'overtime' : s.period === 4 && s.clockSeconds <= 120 ? 'last_2min' :
      s.period === 4 && s.clockSeconds <= 300 ? 'last_5min' : s.period === 4 ? 'fourth' :
      s.period === 2 && s.clockSeconds <= 120 ? 'half_2min' : 'ordinary';
    var bucket = 'd' + s.down + '_' + band + '_' + zone;
    return { bucket: bucket, context: bucket + '|' + score + '|' + phase, identity: String(s.team || '') + '|d' + s.down + '_' + band };
  }
  function predict(model, s) {
    var k = keys(s);
    if (!k || !model || model.schemaVersion !== 1 || model.league !== s.league) return null;
    var context = model.contexts[k.context], team = model.teams[k.identity];
    var prior = model.leagueRates[k.bucket] ?? model.overall;
    var n = context ? context.weightedN : 0, total = context ? context.weightedPasses : 0;
    var base = (total + model.k * prior) / (n + model.k);
    var raw = Math.min(.999, Math.max(.001, base + (team ? team.offset : 0)));
    var z = model.calibration.slope * Math.log(raw / (1 - raw)) + model.calibration.intercept;
    return { probability: 1 / (1 + Math.exp(-z)), raw: raw,
      contextSample: context ? context.n : 0, contextGames: context ? context.games : 0,
      teamSample: team ? team.n : 0, contextKey: k.context, throughSeason: model.throughSeason };
  }
  var api = { keys: keys, predict: predict };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FootballContext = api;
})(typeof window !== 'undefined' ? window : null);

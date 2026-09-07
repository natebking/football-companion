/* The historical disclosure is independent of the main read's cooldown. */
(function (root) {
  'use strict';
  var history = root.FootballHistory;
  function element(tag, text, cls) {
    var el = document.createElement(tag);
    if (text) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }
  function render(container, h) {
    container.replaceChildren();
    if (!h) return;
    container.append(element('h3', h.season + ' season'), element('p', history.describe(h.key), 'history-context'));
    h.rows.forEach(function (row) {
      var section = element('section', '', 'history-team'), c = row.cell;
      section.append(element('h4', row.side === 'offense' ? row.team + ' with the ball' : 'Offenses facing ' + row.team));
      var dl = element('dl');
      function stat(label, numerator, denominator) {
        dl.append(element('dt', label), element('dd', numerator + ' of ' + denominator));
      }
      if (history.conversion(c)) stat('First down or touchdown', c.conversions, c.conversionKnown);
      var run = history.metric(c, 'run'), pass = history.metric(c, 'pass');
      if (run) {
        stat('Runs gaining 2 yards or less', run.twoOrLess, run.yardsKnown);
        stat('Runs gaining 5+ yards', run.fivePlus, run.yardsKnown);
      }
      if (pass) stat('Pass plays gaining 10+ yards', pass.tenPlus, pass.yardsKnown);
      if (dl.children.length) section.append(dl);
      else section.append(element('p', 'Too few clear outcomes to compare.'));
      var unknown = c.n - c.conversionKnown;
      section.append(element('p', c.n + ' plays · ' + c.games + ' games. ' +
        (unknown ? unknown + ' unclear conversion results left out.' : 'Conversion results known for all.'), 'history-sample'));
      container.append(section);
    });
    container.append(element('p', 'Last season’s opponents, players and coaching staff may differ. These counts describe past results, not the next play.', 'history-sample'));
    var method = element('details', '', 'history-method');
    method.append(element('summary', 'How these were counted'));
    method.append(element('p', 'Only the matching down, distance band, field area, score band and clock window are counted. Each team needs at least 20 plays from 5 games. Conversion counts need at least 20 clear results; yardage counts need at least 15. At least 90% of the relevant outcomes must be known.', 'history-sample'));
    method.append(element('p', 'Pass plays include sacks; scrambles count as runs. No-play penalties, kneels and spikes are excluded. Unclear yardage is left out of gain counts.', 'history-sample'));
    h.rows.forEach(function (row) {
      var c = row.cell;
      method.append(element('p', (row.side === 'defense' ? 'Against ' : '') + row.team + ': yardage known for ' + c.run.yardsKnown + ' of ' + c.run.n + ' runs and ' + c.pass.yardsKnown + ' of ' + c.pass.n + ' pass plays.', 'history-sample'));
    });
    container.append(method);
    var source = element('a', h.source.label + ' · data source');
    source.href = h.source.url; source.target = '_blank'; source.rel = 'noopener';
    container.append(source);
  }
  root.FootballHistoryUI = { render: render };
})(window);

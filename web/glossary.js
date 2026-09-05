/* Plain definitions beside the words, with no access to live game data. */
(function (root) {
  'use strict';
  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var extras = {
    safety: 'A safety can mean a defender who lines up deep, or a two-point score for the defense, usually when the offense is stopped in its own end zone.',
    first_down: 'The offense gets four tries to gain 10 yards. Reaching that line earns a first down and four new tries.',
    end_zone: 'The scoring area at each end of the field. Carrying or catching the ball there scores a touchdown.',
    touchdown: 'Carrying or catching the ball in the opponent’s end zone. It is worth six points, followed by a chance for one or two more.',
    interception: 'A defender catches a pass meant for an offensive player. The defense gets the ball and can run it back.',
    fumble: 'A player loses control of the ball before the play is over. Either team can recover it.',
    sack: 'The defense tackles a player trying to pass behind the line where the play began.',
    scramble: 'The quarterback runs after looking for a chance to throw.',
    turnover_on_downs: 'The offense used all four tries without reaching the first-down line. The other team gets the ball.',
    extra_point: 'After a touchdown, the team can kick through the uprights for one more point.',
    shotgun: 'The quarterback starts a few yards behind the center and catches the snap, giving him more room to see the field.',
    no_huddle: 'The offense lines up for the next play without gathering to talk first.',
    possession: 'Which team has the ball and is trying to score.',
    penalty: 'A rule was broken. Officials may move the ball, change the down, or cancel the play. The other team can sometimes decline the penalty.',
    goal_line: 'The line at the front of the end zone. A runner scores when the ball crosses it while still in control.'
  };
  var aliases = {
    safeties: 'safety', linebackers: 'linebacker', receivers: 'receiver',
    'slot receiver': 'slot', 'slot receivers': 'slot',
    intercepted: 'interception', sacked: 'sack', 'turnover on downs': 'turnover_on_downs'
  };
  var definitions = {}, pattern = null, keys = {}, popup, anchor;
  function configure(concepts) {
    definitions = Object.assign({}, concepts || {}, extras);
    keys = {};
    Object.keys(definitions).forEach(function (key) { keys[key.replace(/_/g, ' ')] = key; });
    Object.keys(aliases).forEach(function (word) { if (definitions[aliases[word]]) keys[word] = aliases[word]; });
    var words = Object.keys(keys).sort(function (a, b) { return b.length - a.length; });
    pattern = new RegExp('\\b(' + words.map(function (word) {
      return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ -]');
    }).join('|') + ')\\b', 'gi');
  }
  function annotate(text) {
    text = String(text || '');
    if (!pattern) return esc(text);
    var out = '', at = 0;
    text.replace(pattern, function (word, match, offset) {
      out += esc(text.slice(at, offset));
      var key = keys[word.toLowerCase().replace(/-/g, ' ')];
      out += '<button type="button" class="term-link" data-term="' + esc(key) + '" aria-haspopup="dialog" aria-controls="termPopover">' + esc(word) + '</button>';
      at = offset + word.length;
      return word;
    });
    return out + esc(text.slice(at));
  }
  function close(restoreFocus) {
    if (popup && popup.matches(':popover-open')) popup.hidePopover();
    if (restoreFocus === true && anchor && anchor.isConnected) anchor.focus({ preventScroll: true });
  }
  function show(button) {
    var key = button.dataset.term;
    if (!definitions[key]) return;
    if (anchor === button && popup.matches(':popover-open')) { close(); return; }
    close(); anchor = button;
    popup.querySelector('strong').textContent = key.replace(/_/g, ' ');
    popup.querySelector('p').textContent = definitions[key];
    popup.showPopover();
    var box = button.getBoundingClientRect();
    var width = popup.offsetWidth, height = popup.offsetHeight;
    popup.style.left = Math.max(12, Math.min(box.left, root.innerWidth - width - 12)) + 'px';
    var below = box.bottom + 9;
    popup.style.top = Math.max(12, below + height <= root.innerHeight - 12 ? below : box.top - height - 9) + 'px';
    popup.querySelector('button').focus({ preventScroll: true });
  }
  if (root) {
    popup = root.document.createElement('div');
    popup.id = 'termPopover';
    popup.setAttribute('popover', 'auto');
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-labelledby', 'termTitle');
    popup.setAttribute('aria-describedby', 'termDefinition');
    popup.innerHTML = '<div class="term-heading"><strong id="termTitle"></strong><button type="button" aria-label="Close definition">×</button></div><p id="termDefinition"></p>';
    root.document.body.appendChild(popup);
    popup.querySelector('button').addEventListener('click', function () {
      close(true);
    });
    root.document.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-term]');
      if (button) show(button);
    });
    root.addEventListener('resize', close);
  }
  var api = { configure: configure, annotate: annotate, close: close };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FootballGlossary = api;
})(typeof window !== 'undefined' ? window : null);

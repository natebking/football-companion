/* Apply appearance before the first paint. This preference never touches game state. */
(function () {
  'use strict';
  var root = document.documentElement;
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var preference = 'system';
  try { preference = localStorage.getItem('fc_theme') || 'system'; } catch (e) {}
  if (['light', 'dark', 'system'].indexOf(preference) < 0) preference = 'system';

  function paint() {
    var dark = preference === 'dark' || (preference === 'system' && media.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.colorScheme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#0c1722' : '#f1f4f5';
    var toggle = document.getElementById('themeToggle');
    if (toggle) {
      toggle.setAttribute('aria-label', 'Switch to ' + (dark ? 'light' : 'dark') + ' mode');
      toggle.title = toggle.getAttribute('aria-label');
      toggle.querySelector('.t-icon-swap').dataset.state = dark ? 'a' : 'b';
    }
    document.querySelectorAll('[data-theme-choice]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === preference));
    });
  }
  function choose(value) {
    preference = value;
    try { localStorage.setItem('fc_theme', value); } catch (e) {}
    paint();
  }
  paint();
  media.addEventListener('change', function () { if (preference === 'system') paint(); });
  window.addEventListener('storage', function (event) {
    if (event.key !== 'fc_theme') return;
    preference = ['light', 'dark'].indexOf(event.newValue) >= 0 ? event.newValue : 'system';
    paint();
  });
  document.addEventListener('DOMContentLoaded', function () {
    paint();
    document.getElementById('themeToggle').addEventListener('click', function () {
      choose(root.dataset.theme === 'dark' ? 'light' : 'dark');
    });
    document.querySelectorAll('[data-theme-choice]').forEach(function (button) {
      button.addEventListener('click', function () { choose(button.dataset.themeChoice); });
    });
  });
})();

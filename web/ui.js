/* Layout and dialog behavior, independent of the feed and learning state. */
(function () {
  'use strict';
  var root = document.documentElement;
  var header = document.querySelector('.app-header');
  var readColumn = document.querySelector('.read-column');
  var active = null;
  var restoreFocus = null;

  function measure() {
    root.style.setProperty('--hdr', header.offsetHeight + 'px');
    // Keep the card and its prediction in normal flow when they exceed the
    // available height, including at larger text sizes.
    root.dataset.readFits = String(readColumn.offsetHeight <=
      window.innerHeight - header.offsetHeight - 56);
  }
  var observer = new ResizeObserver(measure);
  observer.observe(header);
  observer.observe(readColumn);
  window.addEventListener('resize', measure);
  measure();

  document.querySelectorAll('.sheet').forEach(function (sheet) {
    new MutationObserver(function () {
      var open = sheet.classList.contains('on');
      sheet.inert = !open;
      if (open && active !== sheet) {
        restoreFocus = document.activeElement;
        active = sheet;
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(function () {
          if (active === sheet) sheet.querySelector('.closex').focus();
        });
      } else if (!open && active === sheet) {
        active = null;
        document.body.style.overflow = '';
        if (restoreFocus && restoreFocus.isConnected) restoreFocus.focus();
        restoreFocus = null;
      }
    }).observe(sheet, { attributes: true, attributeFilter: ['class'] });
  });

  document.addEventListener('keydown', function (event) {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      active.querySelector('.closex').click();
      return;
    }
    if (event.key !== 'Tab') return;
    var controls = Array.from(active.querySelectorAll('button, input, a[href], summary, [tabindex="0"]'))
      .filter(function (element) { return !element.disabled && element.getClientRects().length; });
    var first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !active.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !active.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
})();

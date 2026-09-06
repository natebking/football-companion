/* The journal is read only here. Post-game requests never enter the live queue. */
(function (root) {
  'use strict';
  var doc = root.document, $ = function (id) { return doc.getElementById(id); };
  var journal, catalog = [], selected = null, generation = 0;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); }
  function rich(s) { return root.FootballGlossary.annotate(s || ''); }
  function time(at) { return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) }).then(function (r) {
      if (!r.ok) throw new Error('The review could not be loaded.'); return r.json();
    });
  }
  function paint(title, html) {
    $('reviewTitle').textContent = title; $('reviewContent').innerHTML = html;
    $('reviewSheet').querySelector('.sheetInner').scrollTop = 0;
  }
  function back() { return '<button class="depth-link" type="button" data-review-list>← All games</button>'; }
  function local(key) { return journal.loadGame(key); }
  function meta(key) {
    var game = local(key), item = catalog.find(function (r) { return r.key === key; });
    return game ? Object.assign({}, item || {}, game.meta) : item;
  }
  function list() {
    generation++; selected = null;
    var saved = journal.listGames(), keys = saved.map(function (g) { return g.key; });
    catalog.forEach(function (r) { if (keys.indexOf(r.key) < 0) keys.push(r.key); });
    var status = journal.status();
    paint('Game journal', '<p class="review-lead">Come back to the plays worth another look.</p>' +
      '<p class="note">Your journal saves the guidance and reports from games you open here. It stays in this browser on this website. Download a copy to keep it.</p>' +
      (!status.ok ? '<p class="review-warning" role="status">Saving is paused. ' + esc(status.error) + ' Download a journal, then remove it to free space.</p>' : '') +
      '<div class="review-game-list">' + keys.map(function (key) {
        var info = meta(key), g = local(key);
        return '<button class="review-game" type="button" data-review-game="' + esc(key) + '"><span class="eyebrow">' +
          (g ? 'Your journal' : 'Finished game') + '</span><b>' + esc(info.label || key) + '</b><span>' +
          (g ? g.shown.filter(function (s) { return s.kind === 'guidance'; }).length + ' saved watching prompts' : 'Post-game details available') +
          '</span><span class="review-arrow" aria-hidden="true">↗</span></button>';
      }).join('') + '</div>' + (!keys.length ? '<p class="review-empty">Open a game and your journal will start here. Past viewing sessions were not recorded.</p>' : '') +
      '<p class="depth-caption">Up to 10 games, subject to browser storage space. Older journals are never removed automatically. This is separate from your practice history.</p>');
  }
  function open() {
    root.FootballGlossary.close();
    doc.querySelectorAll('.sheet.on').forEach(function (s) { if (s.id !== 'reviewSheet') s.querySelector('.closex').click(); });
    $('reviewSheet').classList.add('on'); list();
    var request = generation;
    fetchJSON('reviews/index.json').then(function (data) {
      catalog = Array.isArray(data.reviews) ? data.reviews.filter(function (r) { return /^(cfb|nfl):\d+$/.test(r.key); }) : [];
      if (!selected && request === generation && $('reviewSheet').classList.contains('on')) list();
    }).catch(function () {}); // Saved journals remain usable without the catalog.
  }
  function close() { generation++; $('reviewSheet').classList.remove('on'); }
  function showJournal(key) {
    generation++; selected = key;
    var game = local(key), info = meta(key);
    if (!info) { list(); return; }
    var guidance = game ? game.shown.filter(function (s) { return s.kind === 'guidance'; }).slice().reverse() : [];
    var observations = game ? game.observations.filter(function (o) { return o.kind === 'learning'; }) : [];
    paint(info.label || 'Game journal', back() +
      '<section class="review-invitation"><span class="eyebrow">After the game</span><h2>Look at the play again.</h2>' +
      '<p>See what the finished reports add, revisit a few useful plays, and check the guidance we saved.</p>' +
      '<p class="review-spoiler">Includes the result and later plays. Open this when you have finished watching.</p>' +
      '<button class="sync-primary" type="button" data-review-final="' + esc(key) + '">Open post-game review</button></section>' +
      (game ? '<div class="review-actions"><button class="ghost" type="button" data-review-download="' + esc(key) + '">Download journal</button>' +
        '<button class="ghost" type="button" data-review-delete="' + esc(key) + '">Remove journal</button></div>' : '') +
      '<h2 class="review-section-title">What you were shown</h2>' +
      (!guidance.length ? '<p class="note">No watching prompts were saved for this game. The post-game review can explain the plays, but cannot recreate an earlier viewing session.</p>' :
        '<p class="depth-caption">Newest first. Saved when rendered; this does not measure whether you read a prompt.</p>' +
        guidance.map(function (g) { var l = g.lines || {}; return '<article class="journal-prompt"><span class="eyebrow">' + esc(time(g.shownAt || g.at)) +
          ' · ' + esc(l.situation || '') + '</span><p>' + rich(l.watch) + '</p>' + (l.tendency ? '<p class="note">' + esc(l.tendency) + '</p>' : '') +
          (g.visibility !== 'visible' ? '<span class="depth-caption">The app was in the background or a panel was open.</span>' : '') + '</article>'; }).join('')) +
      (observations.length ? '<h2 class="review-section-title">What you noticed</h2>' + observations.map(function (o) {
        return '<article class="journal-prompt"><p>' + esc((o.lessonId || '').replace(/_/g, ' ')) + ': ' + esc((o.choiceId || '').replace(/_/g, ' ')) + '</p><p class="note">' + esc(o.response) + '</p></article>';
      }).join('') + '<p class="depth-caption">Your observations are not graded against the feed.</p>' : ''));
  }
  function fromESPN(data, key) {
    var h = data.header || {}, comp = (h.competitions || [])[0] || {};
    var eventId = String(h.id || comp.id || '');
    if (eventId !== key.split(':')[1] || (comp.id && String(comp.id) !== eventId)) throw new Error('The finished report does not match this game.');
    if (!comp.status || !comp.status.type || !comp.status.type.completed) throw new Error('This game is not marked final yet. Your journal will keep saving as you watch.');
    var drives = data.drives || {}, groups = (drives.previous || []).slice(), unique = new Map();
    if (drives.current) groups.push(drives.current);
    groups.forEach(function (d) { (d.plays || []).forEach(function (p) { unique.set(String(p.id), Object.assign({}, p, { driveId: String(d.id || p.driveId || '') })); }); });
    return { schemaVersion: 1, key: key, league: key.split(':')[0], gameId: key.split(':')[1], status: 'final',
      label: h.shortName || h.name || (meta(key) || {}).label, reviewedAt: new Date().toISOString(),
      teams: (comp.competitors || []).map(function (c) { return { id: String(c.id), abbreviation: c.team.abbreviation, name: c.team.displayName, score: c.score, homeAway: c.homeAway }; }),
      plays: Array.from(unique.values()).map(function (p, i) { return { id: String(p.id), order: i, report: p, enrichment: {} }; }),
      sources: [{ id: 'espn', label: 'ESPN final play reports', url: 'https://www.espn.com/' + (key.startsWith('nfl:') ? 'nfl' : 'college-football') + '/playbyplay/_/gameId/' + key.split(':')[1] }],
      notes: ['Final reports can still be corrected. Additional charting is not available for this review.'] };
  }
  async function loadFinal(key) {
    var request = ++generation; selected = key;
    paint((meta(key) || {}).label || 'Post-game review', back() + '<p class="note" role="status">Checking the finished reports…</p>');
    try {
      var item = catalog.find(function (r) { return r.key === key; }), review;
      if (item && /^(cfb|nfl)-\d+\.json$/.test(item.path)) review = await fetchJSON('reviews/' + item.path);
      else {
        var parts = key.split(':');
        review = fromESPN(await fetchJSON('https://site.api.espn.com/apis/site/v2/sports/football/' +
          (parts[0] === 'nfl' ? 'nfl' : 'college-football') + '/summary?event=' + parts[1]), key);
      }
      if (request !== generation) return;
      if (review.key !== key || review.status !== 'final') throw new Error('The finished report does not match this game.');
      paintReview(review, local(key));
    } catch (e) {
      if (request === generation) paint('Post-game review', back() + '<p class="note" role="status">' + esc(e.message) + '</p><button class="ghost" type="button" data-review-game="' + esc(key) + '">Back to journal</button>');
    }
  }
  function enrich(p, facts) {
    var e = p.enrichment && p.enrichment.passing;
    if (!e || !e.yardageVerified || !/^Pass complete\b/.test(facts.summary || '') || !Number.isFinite(e.airYards) || !Number.isFinite(e.yardsAfterCatch) ||
        e.yardsAfterCatch < 0 || e.airYards + e.yardsAfterCatch !== facts.gained) return null;
    return { air: e.airYards, after: e.yardsAfterCatch };
  }
  function selectMoments(rows) {
    var selected = [], used = new Set();
    function pick(candidates) {
      var r = candidates.find(function (item) { return !used.has(item.p.id); });
      if (r) { selected.push(r); used.add(r.p.id); }
    }
    var completed = rows.filter(function (r) { return r.e && r.f.gained > 0; });
    pick(completed.filter(function (r) { return r.e.after > r.e.air; }).sort(function (a, b) { return b.e.after - a.e.after; }));
    pick(completed.filter(function (r) { return r.e.air > r.e.after; }).sort(function (a, b) { return b.e.air - a.e.air; }));
    pick(rows.filter(function (r) { return r.f.meaning && r.f.need > 0 && r.f.gained >= 0 && r.f.gained < r.f.need &&
      (r.p.report.start || {}).down >= 3 && !r.f.turnover && !r.f.voidReason; }));
    var remaining = rows.filter(function (r) { return r.f.meaning; }).sort(function (a, b) { return (b.f.gained || 0) - (a.f.gained || 0); });
    while (selected.length < 3 && remaining.some(function (r) { return !used.has(r.p.id); })) pick(remaining);
    return selected.sort(function (a, b) { return a.p.order - b.p.order; });
  }
  function paintReview(review, game) {
    var abbr = {}, teams = review.teams || [];
    teams.forEach(function (t) { abbr[t.id] = t.abbreviation; });
    var rows = review.plays.map(function (p) { var facts = root.FootballPlay.describe(p.report, abbr); return { p: p, f: facts, e: enrich(p, facts) }; });
    var moments = selectMoments(rows);
    var comparison = game && root.FootballJournal.compare(game, review);
    var changed = comparison ? comparison.plays.filter(function (p) { return p.status === 'changed'; }) : [];
    paint(review.label || 'Post-game review', back() + '<p class="review-final">Final · ' + teams.map(function (t) { return esc(t.abbreviation) + ' <b>' + esc(t.score) + '</b>'; }).join(' · ') + '</p>' +
      '<p class="review-lead">Plays worth another look.</p><p class="note">A closer look at the reported action and what it meant. These examples do not reconstruct routes or defensive assignments.</p>' +
      moments.map(function (r) { return '<article class="review-moment"><span class="eyebrow">' + esc(abbr[(r.p.report.start || {}).team && r.p.report.start.team.id] || '') + ' · ' + esc((r.p.report.start || {}).downDistanceText || 'Reported play') + '</span>' +
        '<h2>' + esc(r.f.summary) + '</h2>' + (r.e ? '<div class="review-yards"><span><b>' + r.e.air + '</b> yards through the air</span><span><b>' + r.e.after + '</b> after the catch</span></div>' +
          '<p>' + (r.f.need > r.f.gained && (r.p.report.start || {}).down >= 3 ? 'The completion did not earn a first down. With the catch short of the marker, the receiver needed room to run. Watch how much space he has as the ball arrives.' :
            r.e.after > r.e.air ? 'Most of the gain came after the catch. On a play like this, follow the receiver’s space and the first defender who can make the tackle.' :
            r.e.air >= 15 ? 'The throw supplied most of this gain. On a play like this, watch the space between the receiver and the deepest defenders.' :
            'Watch the receiver as the ball arrives. Is there room to turn, or a defender already close enough to make the tackle?') + '</p>' : '') +
        '<p>' + rich(r.f.meaning || r.f.consequence) + '</p>' +
        '<details class="example-sources"><summary>Read the play report</summary><p>' + esc(r.p.report.text) + '</p></details></article>'; }).join('') +
      (!moments.length ? '<p class="note">These reports do not yet provide enough detail for a closer look.</p>' : '') +
      '<section class="review-audit"><h2>Check our analysis</h2>' + (!game ? '<p class="note">There is no saved journal for this game, so we cannot check what the app said while you watched.</p>' :
        '<p>' + comparison.summary.matched + ' saved play explanations matched to the finished report. ' + comparison.summary.changed + ' had changed facts. ' + comparison.summary.enriched + ' gained additional detail.</p>' +
        '<p class="note">A changed fact may be a source correction or an explanation error. Matching the final feed is a consistency check, not independent proof.</p>' +
        changed.slice(0, 8).map(function (p) { return '<details class="review-change"><summary>Updated play ' + esc(p.playId) + '</summary>' +
          p.changes.map(function (c) { return '<p>' + esc(c.field) + ': ' + esc(c.before) + ' → ' + esc(c.after) + '</p>'; }).join('') + '</details>'; }).join('') +
        '<p class="note">' + (comparison.summary.linked ? comparison.summary.linked + ' displayed probabilities were linked to later plays. Prediction scoring will wait until the live and historical sources classify plays consistently.' :
          'No displayed probabilities could be safely linked for this game. We do not match predictions by the game clock.') + '</p>' +
        '<button class="depth-link" type="button" data-review-game="' + esc(review.key) + '">Read your saved guidance ↗</button>') + '</section>' +
      '<details class="review-source-list"><summary>Sources and coverage</summary><p class="note">Checked ' + esc(new Date(review.reviewedAt).toLocaleString()) + '. ' + rows.length + ' play reports.</p>' +
      (review.notes || []).map(function (n) { return '<p class="note">' + esc(n) + '</p>'; }).join('') +
      (review.sources || []).filter(function (s) { return /^https:\/\//.test(s.url); }).map(function (s) {
        return '<p><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.label) + '</a></p>';
      }).join('') + '</details>');
  }
  function init(options) {
    journal = options.journal;
    $('openJournal').addEventListener('click', open);
    $('closeReview').addEventListener('click', close);
    $('reviewSheet').addEventListener('click', function (e) { if (e.target === $('reviewSheet')) close(); });
    $('reviewContent').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-review-list')) list();
      else if (b.dataset.reviewGame) showJournal(b.dataset.reviewGame);
      else if (b.dataset.reviewFinal) loadFinal(b.dataset.reviewFinal);
      else if (b.dataset.reviewDownload) {
        var data = journal.exportGame(b.dataset.reviewDownload);
        if (!data) return;
        var url = URL.createObjectURL(new Blob([data], { type: 'application/json' })), a = doc.createElement('a');
        a.href = url; a.download = 'football-journal-' + b.dataset.reviewDownload.replace(':', '-') + '.json'; a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      } else if (b.dataset.reviewDelete) {
        b.dataset.reviewConfirm = b.dataset.reviewDelete; delete b.dataset.reviewDelete;
        b.textContent = 'Remove this saved journal?';
      } else if (b.dataset.reviewConfirm) {
        var result = journal.removeGame(b.dataset.reviewConfirm);
        if (!result.ok) { b.textContent = result.error; return; }
        $('journalStatus').textContent = 'Saved in this browser'; list();
      }
    });
  }
  root.FootballReview = { init: init, fromESPN: fromESPN, selectMoments: selectMoments };
})(window);

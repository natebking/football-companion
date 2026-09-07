/* Read-only views of released insights and optional football lessons. */
(function (root) {
  'use strict';
  var doc = root.document;
  var $ = function (id) { return doc.getElementById(id); };
  function esc(text) { return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); }
  var examples = null, selectedLesson = null, selectedExample = null, selectedPractice = null;
  var teachingLevel = 'game', lessonContext = null;
  var practiceStorage;
  try { practiceStorage = root.localStorage; } catch (_) {}
  var practice = root.FootballPractice.create({ storage: practiceStorage });
  function rich(text) { return root.FootballGlossary.annotate(text); }
  function resetView() {
    $('learningSheet').querySelector('.sheetInner').scrollTop = 0;
    if (!$('learningSheet').inert) $('closeLearning').focus({ preventScroll: true });
  }

  function open() {
    root.FootballGlossary.close();
    doc.querySelectorAll('.sheet.on').forEach(function (sheet) {
      if (sheet.id !== 'learningSheet') sheet.querySelector('.closex').click();
    });
    $('learningSheet').classList.add('on');
  }
  function close() { $('learningSheet').classList.remove('on'); }
  $('closeLearning').addEventListener('click', close);
  $('learningSheet').addEventListener('click', function (event) { if (event.target === $('learningSheet')) close(); });

  function showLesson(id, context, options) {
    options = options || {};
    var lesson = root.FootballLearning.get(id, { level: teachingLevel });
    if (!lesson) return;
    selectedLesson = lesson; selectedExample = null; selectedPractice = null;
    // Capture the opener's identity. Later game/feed changes must not relabel an
    // observation of the example or play the user actually opened.
    lessonContext = {
      context: context || '', origin: options.origin || 'reference',
      exampleId: options.exampleId || null, journalKey: options.journalKey || null,
      playId: options.playId || null
    };
    $('learningTitle').textContent = lesson.title;
    $('learningContent').innerHTML = (context ? '<p class="depth-context">' + esc(context) + '</p>' : '') +
      '<p class="learning-level">' + (lesson.level === 'basics' ? 'Start with basics' : 'Read the game') + '</p>' +
      '<p class="learning-intro">' + rich(lesson.explanation) + '</p>' +
      root.FootballLearning.renderDiagram(id, { level: lesson.level }) +
      '<p class="learning-caption">' + esc(lesson.diagramCaption) + '</p>' +
      (lesson.followUp ? '<p class="learning-next"><b>Watch next</b>' + rich(lesson.followUp) + '</p>' : '') +
      '<section class="learning-observe" aria-labelledby="observeTitle"><span class="eyebrow">Your observation</span>' +
      '<h2 id="observeTitle">' + esc(lesson.question) + '</h2><p class="depth-caption">Your observation, not checked against the feed. Choose “Couldn’t tell” if the camera missed it.</p>' +
      '<div class="learning-choices">' + lesson.choices.map(function (choice) {
        return '<button type="button" data-observation="' + esc(choice.id) + '" aria-pressed="false">' + esc(choice.label) + '</button>';
      }).join('') + '</div><p id="observationResponse" class="learning-response" role="status" hidden></p></section>' +
      '<button type="button" class="depth-link" data-example-library>Explore a real past play <span aria-hidden="true">↗</span></button>';
    open();
    resetView();
  }
  function yardageGraphic(facts) {
    if (!facts || !Number.isFinite(facts.airYards) || !Number.isFinite(facts.yardsAfterCatch) ||
        facts.yardsAfterCatch < 0 || facts.airYards + facts.yardsAfterCatch !== facts.yardsGained) return '';
    var air = facts.airYards, after = facts.yardsAfterCatch, total = facts.yardsGained;
    var low = Math.min(0, air), high = Math.max(1, total, air), span = high - low;
    var x = function (yards) { return 30 + (yards - low) / span * 440; };
    return '<div class="yardage-breakdown"><svg viewBox="0 0 500 84" role="img" aria-label="' + esc(air + ' yards through the air, ' + after + ' after the catch, ' + total + ' total.') + '">' +
      '<path d="M30 28H470M30 52H470" class="yardage-track"/><path d="M' + x(0) + ' 28H' + x(air) + '" class="yardage-air"/>' +
      '<path d="M' + x(air) + ' 52H' + x(total) + '" class="yardage-run"/>' +
      '<path d="M' + x(0) + ' 14V66" class="yardage-start"/><circle cx="' + x(air) + '" cy="28" r="6" class="yardage-catch"/>' +
      '</svg><div class="yardage-labels"><span><b>' + air + '</b> yards through the air</span><span><b>' + after + '</b> after the catch</span></div>' +
      '<p class="depth-caption">Top: throw. Bottom: yards after the catch. The vertical line marks where the play began. This shows distance, not the receiver’s route.</p></div>';
  }
  function sourceLinks(list) {
    return (list || []).map(function (source) {
      if (!/^https:\/\//.test(source.url || '')) return '';
      return '<a href="' + esc(source.url) + '" target="_blank" rel="noopener noreferrer">' + esc(source.label) + '</a>' +
        (source.license && /^https:\/\//.test(source.licenseUrl || '') ? ' · <a href="' + esc(source.licenseUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(source.license) + '</a>' : '');
    }).filter(Boolean).join('<br>');
  }
  function topicLesson(topic) {
    var lessons = { screen: 'screen_blockers', 'play-action': 'handoff_fake', 'down-and-distance': 'first_down_line',
      pressure: 'pocket_edges', 'yards-after-catch': teachingLevel === 'basics' ? 'first_down_line' : 'catch_and_run' };
    return lessons[topic] ? root.FootballLearning.get(lessons[topic], { level: teachingLevel }) : null;
  }
  function adaptationNotice(example) {
    if (!(example.sources || []).some(function (source) { return source.label === 'FTN Data via nflverse'; })) return '';
    return '<p class="depth-caption">Adapted from FTN Data via nflverse: charted facts joined with play-by-play, summarized and illustrated for this lesson. ' +
      'This adaptation is available under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>. ' +
      '<a href="data.html#charting" target="_blank" rel="noopener">Source and licence details ↗</a></p>';
  }
  function showExample(id) {
    var example = examples && examples.examples.find(function (entry) { return entry.id === id; });
    if (!example) return;
    selectedExample = example; selectedLesson = null; selectedPractice = null;
    practice.seen(example);
    var topic = topicLesson(example.topic);
    $('learningTitle').textContent = example.title;
    $('learningContent').innerHTML = '<button type="button" class="depth-link" data-example-library>← All examples</button>' +
      '<p class="example-label">Past game · ' + esc(example.season) + ' · ' + esc(example.offense) + ' vs ' + esc(example.defense) + '</p>' +
      '<h2 class="example-summary">' + esc(example.summary) + '</h2><p class="learning-intro">' + rich(example.explanation) + '</p>' +
      yardageGraphic(example.facts) +
      (root.FootballPractice.pairFor(examples, id) ? '<section class="practice-invitation"><h2>Read another play</h2>' +
        '<p>Try the same idea on a different game before seeing its explanation.</p>' +
        '<button type="button" class="ghost" data-practice-start="' + esc(id) + '">Try another play</button></section>' : '') +
      (topic ? root.FootballLearning.renderDiagram(topic.id, { level: teachingLevel }) + '<p class="learning-caption">' + esc(topic.diagramCaption) + '</p>' +
        '<button type="button" class="depth-link" data-lesson="' + esc(topic.id) + '" data-lesson-origin="library" data-lesson-example="' + esc(example.id) + '">Learn what to watch <span aria-hidden="true">↗</span></button>' : '') +
      adaptationNotice(example) + '<details class="example-sources"><summary>Source and play details</summary><p>' + sourceLinks(example.sources) + '</p>' +
      '<p class="depth-caption">Game ' + esc(example.gameId) + ' · Play ' + esc(example.playId) + '</p></details>';
    resetView();
  }
  function paintLibrary() {
    selectedLesson = null; selectedExample = null; selectedPractice = null;
    var targets = new Set(examples.practice.map(function (p) { return p.testExampleId; }));
    $('learningTitle').textContent = 'Explore plays';
    $('learningContent').innerHTML = '<p class="learning-intro">' + esc(examples.notice) + '</p><div class="example-list">' +
      examples.examples.filter(function (example) { return !targets.has(example.id); }).map(function (example) {
        return '<button type="button" class="example-choice" data-example="' + esc(example.id) + '"><span class="example-label">' +
          esc(example.season) + ' · ' + esc(example.offense) + ' vs ' + esc(example.defense) + '</span><b>' + esc(example.title) +
          '</b><span>' + esc(example.summary) + '</span><span class="example-arrow" aria-hidden="true">↗</span></button>';
      }).join('') + '</div><details class="example-sources"><summary>Practice history</summary>' +
      '<p>Your answers stay in this browser. Download them to review or share them. They do not change live predictions or mark a skill as learned.</p>' +
      '<p id="practiceStorageStatus" role="status">' + practiceStatus() + '</p>' +
      '<div class="review-actions"><button type="button" class="ghost" data-practice-download>Download practice</button>' +
      '<button type="button" class="ghost" data-practice-clear>Clear practice history</button></div></details>';
    resetView();
  }
  function showLibrary() {
    $('learningTitle').textContent = 'Explore plays';
    selectedLesson = null; selectedExample = null; selectedPractice = null;
    open();
    if (examples) { paintLibrary(); return; }
    $('learningContent').innerHTML = '<p class="learning-intro" role="status">Loading the examples…</p>';
    fetch('teaching-examples.json').then(function (response) { if (!response.ok) throw new Error('unavailable'); return response.json(); }).then(function (data) {
      examples = data;
      if (!selectedLesson && !selectedExample) paintLibrary();
    }).catch(function () {
      if (!selectedLesson && !selectedExample) $('learningContent').innerHTML = '<p class="learning-intro">The examples could not load. Close this panel and try again.</p>';
    });
  }

  function practiceStatus() {
    var status = practice.status();
    return !status.saved ? 'Browser storage is unavailable. This session’s answers can be downloaded; older records have not been overwritten.' :
      status.full ? 'Practice history is full. Download it, then clear it to save new attempts.' : 'Saved in this browser. Nothing is uploaded.';
  }
  function startPractice(id) {
    if (!selectedExample || selectedExample.id !== id) return;
    var attempt = practice.start(examples, id, teachingLevel);
    if (!attempt) {
      $('learningContent').insertAdjacentHTML('beforeend', '<p role="status" class="depth-caption">' + practiceStatus() + '</p>');
      return;
    }
    selectedPractice = attempt; selectedExample = null; selectedLesson = null;
    var target = examples.examples.find(function (e) { return e.id === attempt.target.id; });
    $('learningTitle').textContent = 'Read another play';
    $('learningContent').innerHTML = '<button type="button" class="depth-link" data-example-library>← All examples</button>' +
      '<p class="example-label">Past game · ' + esc(target.season) + ' · ' + esc(target.offense) + ' vs ' + esc(target.defense) + '</p>' +
      '<p class="learning-intro">' + esc(attempt.pair.evidence) + '</p>' +
      '<section class="learning-observe practice-question" aria-labelledby="practiceQuestion"><h2 id="practiceQuestion">' + esc(attempt.pair.question) + '</h2>' +
      '<div class="learning-choices">' + attempt.pair.choices.concat([{ id: 'unsure', label: 'Not sure' }]).map(function (choice) {
        return '<button type="button" data-practice-answer="' + esc(choice.id) + '" aria-pressed="false">' + esc(choice.label) + '</button>';
      }).join('') + '</div><div id="practiceResponse" class="learning-response" role="status" tabindex="-1" hidden></div></section>' +
      '<p class="depth-caption">' + (attempt.priorExampleOpened || attempt.priorTargetQuestions > 0 ? 'You have opened this play or a question about it before. This attempt is saved as a repeat. ' : '') + practiceStatus() + '</p>' +
      adaptationNotice(target) + '<details class="example-sources"><summary>Sources</summary><p>' + sourceLinks(target.sources) + '</p></details>';
    resetView();
  }
  function answerPractice(choice) {
    if (!selectedPractice) return;
    var result = practice.answer(selectedPractice.id, choice.dataset.practiceAnswer);
    if (!result) return;
    selectedPractice = result;
    $('learningContent').querySelectorAll('[data-practice-answer]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b === choice)); b.disabled = true;
    });
    $('practiceResponse').innerHTML = '<b>' + (result.result === 'supported' ? 'That fits the evidence.' : result.result === 'unsure' ? 'Here’s what the record supports.' : 'Take another look at the evidence.') + '</b><p>' +
      rich(result.pair.explanation) + '</p><button type="button" class="depth-link" data-example="' + esc(result.target.id) + '">See the full play explanation ↗</button>' +
      '<p class="depth-caption">' + practiceStatus() + '</p>';
    $('practiceResponse').hidden = false;
    $('practiceResponse').focus({ preventScroll: true });
    $('practiceResponse').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  function renderInsights(insights) {
    var drive = insights.drive;
    $('driveStory').hidden = !drive;
    if (drive) {
      $('driveTitle').textContent = drive.complete ? 'Last drive' : 'This drive';
      $('driveTeam').textContent = drive.team || '';
      $('driveSummary').textContent = drive.summary;
      var progress = (drive.progress || []).filter(function (step) { return Number.isFinite(step.from) && Number.isFinite(step.to); });
      $('driveGraphic').innerHTML = progress.length ? '<div class="drive-progress" role="img" aria-label="' + esc(drive.summary) + '"><svg viewBox="0 0 500 78">' +
        '<path d="M30 20V64M140 28V64M250 20V64M360 28V64M470 20V64" class="drive-yards"/>' +
        progress.map(function (step, index) {
          var y = 32 + (index % 3) * 10;
          return '<path d="M' + (30 + step.from * 4.4) + ' ' + y + 'H' + (30 + step.to * 4.4) + '" class="drive-step ' + (step.kind === 'penalty' ? 'drive-penalty' : '') + '"/>';
        }).join('') + '<circle cx="' + (30 + progress[progress.length - 1].to * 4.4) + '" cy="' + (32 + ((progress.length - 1) % 3) * 10) + '" r="5" class="drive-ball"/>' +
        '</svg><div class="drive-legend"><span>Own goal</span><span>Green: plays · Gold: penalties</span><span>End zone →</span></div></div>' : '';
      $('driveNote').textContent = drive.verified ? drive.playCount + ' reported ' + (drive.playCount === 1 ? 'play' : 'plays') + '. Based on the start and end spots in the reports.' : 'Some play positions are incomplete. A drive total is not available yet.';
    }
    var teams = Array.isArray(insights.teams) ? insights.teams : Object.values(insights.teams || {});
    $('gamePatterns').hidden = !teams.length;
    $('patternDetails').innerHTML = teams.map(function (team) {
      return '<div class="pattern-team"><h3>' + esc(team.team) + '</h3>' + (team.summaries || []).map(function (line) {
        return '<p>' + esc(line) + '</p>';
      }).join('') + (team.coverage && team.coverage.text ? '<p class="depth-caption">' + esc(team.coverage.text) + '</p>' : '') + '</div>';
    }).join('');
  }
  doc.addEventListener('click', function (event) {
    var start = event.target.closest('[data-practice-start]');
    if (start) { startPractice(start.dataset.practiceStart); return; }
    var answer = event.target.closest('[data-practice-answer]');
    if (answer) { answerPractice(answer); return; }
    if (event.target.closest('[data-practice-download]')) {
      var url = URL.createObjectURL(new Blob([practice.export()], { type: 'application/json' }));
      var link = doc.createElement('a'); link.href = url; link.download = 'football-practice.json'; link.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000); return;
    }
    if (event.target.closest('[data-practice-clear]')) {
      if (root.confirm('Clear the practice history saved in this browser? Download a copy first if you want to keep it.')) {
        if (practice.clear()) paintLibrary();
        else $('practiceStorageStatus').textContent = 'The browser could not clear practice history.';
      }
      return;
    }
    var lessonButton = event.target.closest('[data-lesson]');
    if (lessonButton) {
      showLesson(lessonButton.dataset.lesson, lessonButton.dataset.lessonContext, {
        origin: lessonButton.dataset.lessonOrigin, exampleId: lessonButton.dataset.lessonExample,
        journalKey: lessonButton.dataset.lessonJournalKey, playId: lessonButton.dataset.lessonPlay
      });
      return;
    }
    var exampleButton = event.target.closest('[data-example]');
    if (exampleButton) { showExample(exampleButton.dataset.example); return; }
    if (event.target.closest('[data-example-library]')) { showLibrary(); return; }
    var choice = event.target.closest('[data-observation]');
    if (choice && selectedLesson) {
      var response = root.FootballLearning.observationResponse(selectedLesson.id, choice.dataset.observation, { level: selectedLesson.level });
      if (!response) return;
      $('learningContent').querySelectorAll('[data-observation]').forEach(function (button) { button.setAttribute('aria-pressed', String(button === choice)); });
      $('observationResponse').innerHTML = rich(response);
      $('observationResponse').hidden = false;
      root.dispatchEvent(new root.CustomEvent('football-observation', { detail: {
        lessonId: selectedLesson.id, choiceId: choice.dataset.observation,
        response: response, level: selectedLesson.level,
        origin: lessonContext.origin, context: lessonContext.context,
        exampleId: lessonContext.exampleId, journalKey: lessonContext.journalKey,
        playId: lessonContext.playId,
        isLiveContext: lessonContext.origin === 'live' || lessonContext.origin === 'reported-play'
      } }));
    }
  });
  function setTeachingLevel(level) {
    teachingLevel = level === 'basics' ? 'basics' : 'game';
    if (!$('learningSheet').classList.contains('on')) return;
    if (selectedLesson) {
      var id = selectedLesson.id;
      if (teachingLevel === 'basics') {
        var basicTopic = { defender_conflict: 'route_break', catch_and_run: 'first_down_line', recurring_look: 'motion' };
        id = basicTopic[id] || id;
      }
      showLesson(id, lessonContext.context, lessonContext);
    } else if (selectedExample) showExample(selectedExample.id);
  }
  $('exploreExamples').addEventListener('click', showLibrary);
  root.FootballDepth = { showLesson: showLesson, showLibrary: showLibrary,
    setTeachingLevel: setTeachingLevel, renderInsights: renderInsights };
})(window);

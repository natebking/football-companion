const test = require('node:test');
const assert = require('node:assert/strict');
const display = require('../web/player-display.js');
const roster = require('../web/roster.js');
const insights = require('../web/game-insights.js');
const read = require('../web/game-read.js');
const options = { league: 'cfb', teamId: '68', season: 2026, retrievedAt: '2026-09-13T12:00:00Z' };
const record = roster.fromResponse({ team: { id: '68' }, season: { year: 2026 }, athletes: [{ items: [
  { id: '1', fullName: 'Maddux Madsen', shortName: 'M. Madsen', jersey: '4' },
  { id: '2', fullName: 'Reported Receiver', shortName: 'R. Receiver', jersey: '19' }
] }] }, options);
const resolve = (team, name) => team === '68' ? roster.resolve(record, name) : null;

test('player cue display expands identity while source keys and evidence stay unchanged', () => {
  const plays = [1, 2, 3].map(id => ({ id: String(id), driveId: 'one', type: { text: 'Pass Incompletion' },
    text: '#4 M.Madsen pass incomplete short right to R.Receiver', statYardage: 0,
    start: { down: 3, distance: 8, team: { id: '68' }, yardsToEndzone: 70 },
    end: { down: 4, distance: 8, team: { id: '68' }, yardsToEndzone: 70 } }));
  const context = { gameId: 'game', down: 3, distance: 8, yardsToGoal: 70,
    period: 1, clockSeconds: 600, scoreDiff: 0, offenseTeam: { id: '68' } };
  const summary = insights.summarize(plays, { teamAbbreviations: { 68: 'BOIS' } });
  const evidence = insights.forRead(summary, 'game');
  const cue = read.select(context, evidence);
  const original = structuredClone({ summary, evidence, cue });
  const view = display.read(cue, '68', resolve);
  assert.match(view.headline, /#19 Reported Receiver/);
  assert.match(view.detail, /3 of 3 reported throws/);
  assert.equal(view.identities.length, 1);
  assert.match(display.insights(summary, resolve).teams[0].summaries.join(' '), /#19 Reported Receiver: 3 reported targets/);
  assert.deepEqual({ summary, evidence, cue }, original);
  assert.deepEqual(read.select(context, evidence), cue);
  assert.equal(display.read(cue, 'other', resolve).headline, cue.headline);
});
test('supporting workload and last-play explanations use the same labels', () => {
  const view = display.read({ headline: 'Watch the first-down line.', detail: '8 yards to go.', watch: '',
    supportingPlayer: { name: '#4 M.Madsen', detail: '3 runs by #4 M.Madsen.' } }, '68', resolve);
  assert.equal(view.headline, 'Watch the first-down line.');
  assert.equal(view.playerContext, 'Player workload · 3 runs by #4 Maddux Madsen.');
  const raw = { teamId: '68', people: { passer: '#4 M.Madsen', receiver: 'R.Receiver' },
    players: '#4 M.Madsen to R.Receiver', takeaway: 'R.Receiver gained 8 yards.' };
  const copy = display.play(raw, resolve);
  assert.equal(copy.players, '#4 Maddux Madsen to #19 Reported Receiver');
  assert.equal(copy.takeaway, '#19 Reported Receiver gained 8 yards.');
  assert.equal(raw.players, '#4 M.Madsen to R.Receiver');
});
test('identity replacement respects boundaries, literal punctuation and duplicate aliases', () => {
  const ids = [{ reportedName: '#4 M.Madsen', label: '#4 Maddux Madsen' }];
  assert.equal(display.text('#4 M.Madsen. M.Madsen gained 8. XM.Madsen and M.MadsenX.', ids),
    '#4 Maddux Madsen. #4 Maddux Madsen gained 8. XM.Madsen and M.MadsenX.');
  assert.equal(display.text('AMMadsen', ids), 'AMMadsen');
  const collisions = [{ reportedName: '#1 D.Moore', label: '#1 Defender Moore' }, { reportedName: '#5 D.Moore', label: '#5 Dante Moore' }];
  assert.equal(display.text('#1 D.Moore and #5 D.Moore; D.Moore', collisions), '#1 Defender Moore and #5 Dante Moore; D.Moore');
});

test('one resolved alias cannot rewrite an unresolved player or a conflicting report number', () => {
  const ids = [{ reportedName: '#4 M.Madsen', label: '#4 Maddux Madsen' }];
  assert.equal(display.text('#8 M.Madsen', ids), '#8 M.Madsen');
  const names = ['#4 M.Madsen', '#8 M.Madsen', 'M.Madsen Jr.'];
  assert.equal(display.text('#4 M.Madsen to #8 M.Madsen. M.Madsen Jr. and M.Madsen', ids, names),
    '#4 Maddux Madsen to #8 M.Madsen. M.Madsen Jr. and M.Madsen');
});

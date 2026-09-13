const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const roster = require('../web/roster.js');
const options = { league: 'nfl', teamId: '17', season: 2026, retrievedAt: '2026-09-13T12:00:00Z' };
function response(items) { return { team: { id: '17' }, season: { year: 2026 }, athletes: [{ items }] }; }
function record(items) { return roster.fromResponse(response(items), options); }
const maye = { id: '1', fullName: 'Drake Maye', displayName: 'Drake Maye', shortName: 'D. Maye', jersey: '10' };

test('only source identity and scoped retrieval metadata survive; inputs stay unchanged', () => {
  const raw = response([{ ...maye, status: { name: 'Active' }, injuries: [1], stats: [2], position: { name: 'QB' }, firstName: 'Drake', lastName: 'Maye' }]);
  raw.coach = { name: 'coach' }; raw.standings = [3];
  const before = structuredClone(raw);
  const out = roster.fromResponse(raw, options);
  assert.deepEqual(raw, before);
  assert.deepEqual(Object.keys(out), ['schemaVersion', 'league', 'teamId', 'season', 'retrievedAt', 'sourceUrl', 'athletes']);
  assert.deepEqual(Object.keys(out.athletes[0]), ['id', 'displayName', 'fullName', 'shortName', 'firstName', 'lastName', 'jersey']);
  assert.equal(out.sourceUrl, 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/17/roster?season=2026');
  assert.equal(roster.resolve(out, 'D.Maye').label, '#10 Drake Maye');
});
test('exact official aliases normalize punctuation, space, case, apostrophes and accents', () => {
  const out = record([{ id: '2', fullName: 'José O’Neal Jr.', shortName: 'J. O’Neal Jr.', jersey: '0' }]);
  assert.equal(roster.displayName(out, " j.o'neal jr "), '#0 José O’Neal Jr.');
  assert.equal(roster.resolve(out, 'J.ONeal'), null);
  assert.equal(roster.resolve(out, 'José ONeal'), null);
  assert.equal(roster.resolve(out, 'ONeal'), null);
  assert.equal(roster.resolve(out, '#0'), null);
  assert.equal(roster.resolve(record([maye]), 'D May'), null);
  assert.equal(roster.resolve(record([{ ...maye, shortName: undefined }]), 'D.Maye'), null);
});
test('explicit report number including zero survives, while conflicting numbers prevent expansion', () => {
  const out = record([maye, { id: '2', fullName: 'Zero Player', shortName: 'Z.Player', jersey: 0 }]);
  assert.deepEqual(roster.resolve(out, '#0 Z.Player'), { athleteId: '2', label: '#0 Zero Player', reportedName: '#0 Z.Player', fullName: 'Zero Player', jersey: '0', numberSource: 'report' });
  assert.equal(roster.displayName(out, '#9 D.Maye'), '#9 D.Maye');
  const unknown = record([{ ...maye, jersey: '' }]);
  assert.equal(roster.resolve(unknown, '#0 D.Maye').label, '#0 Drake Maye');
  assert.equal(roster.resolve(unknown, 'D.Maye').numberSource, null);
});
test('alias collisions require agreeing report numbers; unknown numbers remain possible', () => {
  const a = { id: '2', fullName: 'Dylan Maye', shortName: 'D. Maye', jersey: '11' };
  const out = record([maye, a]);
  assert.equal(roster.resolve(out, 'D.Maye'), null);
  assert.equal(roster.resolve(out, '#10 D.Maye').athleteId, '1');
  assert.equal(roster.resolve(record([maye, { ...a, jersey: '' }]), '#10 D.Maye'), null);
  assert.equal(roster.resolve(record([maye, { ...a, jersey: '10' }]), '#10 D.Maye'), null);
  assert.equal(roster.resolve(record([maye, { ...a, jersey: '10' }]), 'Dylan Maye').athleteId, '2');
});
test('suffixes do not collapse and unrelated or former players stay as reported', () => {
  const out = record([{ id: '1', fullName: 'John Smith Jr.', shortName: 'J.Smith Jr.' }, { id: '2', fullName: 'John Smith III', shortName: 'J.Smith III' }]);
  assert.equal(roster.resolve(out, 'John Smith'), null);
  assert.equal(roster.resolve(out, 'J.Smith III').athleteId, '2');
  assert.equal(roster.displayName(record([maye]), 'M.Jones'), 'M.Jones');
});
test('wrong scopes, missing identity, and empty historical groups signal unavailable', () => {
  assert.throws(() => roster.fromResponse(response([maye]), { ...options, teamId: '52' }), /match/);
  assert.throws(() => roster.fromResponse(response([maye]), { ...options, season: 2025 }), /match/);
  assert.throws(() => roster.fromResponse(response([]), options), /unavailable/);
  assert.throws(() => record([{ fullName: 'No ID' }, { id: '1' }]), /unavailable/);
  assert.throws(() => roster.fromResponse(null, options), /match/);
});
test('identical duplicate IDs deduplicate; conflicting IDs fail closed', () => {
  assert.equal(record([maye, structuredClone(maye)]).athletes.length, 1);
  assert.throws(() => record([maye, { ...maye, jersey: '11' }]), /Conflicting/);
  assert.throws(() => record([maye, { ...maye, fullName: 'Other Person' }]), /Conflicting/);
  assert.equal(roster.resolve({ schemaVersion: 1, athletes: [maye, { ...maye, jersey: '11' }] }, 'D.Maye'), null);
});
test('invalid roster numbers never become labels and resolution does not mutate its record', () => {
  for (const value of ['100', '-1', 'QB', 1.5, null]) {
    const out = record([{ ...maye, jersey: value }]);
    const before = structuredClone(out);
    assert.equal(roster.resolve(out, 'D.Maye').label, 'Drake Maye');
    assert.equal(roster.resolve(out, 'D.Maye').jersey, null);
    assert.deepEqual(out, before);
  }
});
test('NFL and college grouped payloads flatten without retaining roster groups', () => {
  for (const [league, teamId, endpoint] of [['nfl', '17', 'nfl'], ['cfb', '52', 'college-football']]) {
    const data = {
      team: { id: teamId }, season: { year: 2026 },
      athletes: [
        { position: 'offense', items: [{ ...maye, position: { name: 'QB' }, status: { name: 'Active' } }] },
        { position: 'defense', items: [{ id: '2', fullName: 'Defensive Player', shortName: 'D. Player', jersey: '10', stats: [1] }] },
        { position: 'specialTeams', items: [] }
      ]
    };
    const out = roster.fromResponse(data, { ...options, league, teamId });
    assert.equal(out.sourceUrl, `https://site.api.espn.com/apis/site/v2/sports/football/${endpoint}/teams/${teamId}/roster?season=2026`);
    assert.equal(out.athletes.length, 2);
    assert.equal(roster.resolve(out, 'D.Player').athleteId, '2');
    assert.ok(out.athletes.every(a => Object.keys(a).every(k => ['id', 'displayName', 'fullName', 'shortName', 'firstName', 'lastName', 'jersey'].includes(k))));
  }
});
test('browser global exports the same API without DOM access', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/roster.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.window.FootballRoster), Object.keys(roster));
});

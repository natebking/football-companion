import { mkdir, writeFile } from 'node:fs/promises';
import replay from '../web/replay.js';

const gameId = '401856661';
const sourceUrl = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${gameId}`;
const output = new URL('../web/replays/louisville-ole-miss-2026.json', import.meta.url);

function fail(message) { throw new Error(`Replay export failed: ${message}`); }
function pick(source, keys) {
  const result = {};
  for (const key of keys) if (source[key] !== undefined && source[key] !== null) result[key] = source[key];
  return result;
}
function team(competitor) {
  const value = competitor.team || {};
  return {
    id: String(competitor.id || value.id || ''),
    homeAway: competitor.homeAway,
    team: {
      id: String(value.id || competitor.id || ''), location: value.location || '', name: value.name || '',
      nickname: value.nickname || '', abbreviation: value.abbreviation || '', displayName: value.displayName || '',
      shortDisplayName: value.shortDisplayName || '', color: value.color || '', alternateColor: value.alternateColor || '',
      logos: (value.logos || []).filter(logo => (logo.rel || []).includes('default') || (logo.rel || []).includes('dark'))
        .map(logo => pick(logo, ['href', 'width', 'height', 'alt', 'rel']))
    }
  };
}
function play(value, driveId) {
  return Object.assign({ driveId: String(driveId) }, pick(value, [
    'id', 'sequenceNumber', 'type', 'text', 'awayScore', 'homeScore', 'period', 'clock',
    'scoringPlay', 'isPenalty', 'statYardage', 'start', 'end', 'isTurnover',
    'pointAfterAttempt', 'scoringType', 'scoreValue', 'airYards', 'yardsAfterCatch',
    'air_yards', 'yards_after_catch', 'complete_pass'
  ]));
}

const response = await fetch(sourceUrl);
if (!response.ok) fail(`ESPN returned HTTP ${response.status}`);
const source = await response.json();
const header = source.header || {}, competition = (header.competitions || [])[0];
if (String(header.id || '') !== gameId) fail('unexpected game id');
if (!competition || competition.status?.type?.state !== 'post' || competition.status?.type?.completed !== true) {
  fail('ESPN game is not final');
}
if (competition.date !== '2026-09-06T23:30Z') fail(`unexpected game date ${competition.date || 'missing'}`);
const drives = source.drives?.previous;
if (!Array.isArray(drives) || !drives.length || source.drives?.current) fail('complete final drives are unavailable');

const positions = new Map(), plays = [];
for (const drive of drives) for (const value of drive.plays || []) {
  const normalized = play(value, drive.id);
  if (!normalized.id) fail(`play without id in drive ${drive.id}`);
  const id = String(normalized.id);
  normalized.id = id;
  if (positions.has(id)) plays[positions.get(id)] = normalized;
  else { positions.set(id, plays.length); plays.push(normalized); }
}
if (!plays.length || !/^End (?:of )?Game$/i.test(plays.at(-1).type?.text || '')) fail('terminal game marker is unavailable');

function after(playId) {
  const index = plays.findIndex(value => value.id === playId);
  if (index < 0) fail(`required play ${playId} is unavailable`);
  return { afterPlayId: playId };
}
const firstThird = plays.find(value => value.period?.number === 3);
const firstFourth = plays.find(value => value.period?.number === 4);
if (!firstThird || !firstFourth) fail('half or fourth-quarter boundary is unavailable');

const data = {
  schemaVersion: 1,
  kind: 'football-replay',
  gameId,
  league: 'cfb',
  label: 'Louisville at Ole Miss',
  playedAt: competition.date,
  sourceUrl,
  retrievedAt: new Date().toISOString(),
  sourceStatus: 'final',
  sourceNote: 'Final ESPN play reports can differ from reports released during the live game.',
  season: { year: header.season?.year, type: header.season?.type },
  teams: (competition.competitors || []).map(team),
  initialAfterPlayId: '401856661687',
  momentSpecs: [
    { label: 'Start', count: 0 },
    { label: 'Second half', ...after(firstThird.id) },
    { label: 'Fourth quarter', ...after(firstFourth.id) },
    { label: 'A drive gets backed up', ...after('401856661683') },
    { label: 'A new possession', ...after('401856661687') },
    { label: 'Yards after the catch', ...after('401856661693') },
    { label: 'A costly penalty', ...after('401856661703') },
    { label: 'Pressure on the quarterback', ...after('401856661714') },
    { label: 'Final', ...after(plays.at(-1).id) }
  ],
  plays
};

replay.prepare(data);
await mkdir(new URL('../web/replays/', import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Wrote ${plays.length} reports to ${output.pathname}`);

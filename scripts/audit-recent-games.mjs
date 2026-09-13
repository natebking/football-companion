// Final-report prefix audit; this is not a journal or reconstructed live timing.
// node scripts/audit-recent-games.mjs [--refresh] [--out path] [--journal journal.json]...
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import replay from '../web/replay.js';
import insights from '../web/game-insights.js';
import reads from '../web/game-read.js';
import facts from '../web/play-facts.js';
import history from '../web/game-history.js';
import journalAudit from '../engine/journal_audit.js';
const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'data/qa/recent-games-2026-09-13');
const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const out = args.includes('--out') ? resolve(args[args.indexOf('--out') + 1]) : resolve(dir, 'audit.json');
const journalFiles = args.flatMap((arg, i) => arg === '--journal' ? [args[i + 1]] : []);
const sample = [
 ['cfb','401858212','Sept 7 close conference game'],
 ['cfb','401856678','Friday regional matchup'],
 ['cfb','401856682','close top-ranked Saturday matchup'],
 ['cfb','401856679','low-scoring Saturday matchup'],
 ['cfb','401856782','higher-scoring Saturday matchup'],
 ['cfb','401858213','Thursday FBS/FCS blowout'],
 ['nfl','401872656','first NFL final in date window'],
 ['nfl','401872657','second NFL final in date window']
];
await mkdir(dir, { recursive: true });
// Execute the actual current whitelist functions, rather than a second parser.
const app = await readFile(resolve(root, 'web/app.js'), 'utf8');
const names = ['isMarker','spotFromText','fixSituation','sitKeyOf','clockToSeconds','trimTeam','preSnap'];
const extracted = names.map(name => {
 const match = app.match(new RegExp('^function ' + name + '\\([^]*?^\\}', 'm'));
 if (!match) throw Error('Cannot locate current app function: ' + name);
 return match[0];
}).join('\n');
const context = vm.createContext({ st: { gameId: '' } });
vm.runInContext(extracted, context);
const sha = value => createHash('sha256').update(value).digest('hex');
const hashes = {};
for (const file of ['web/app.js','web/replay.js','web/game-insights.js','web/game-read.js','web/play-facts.js','web/game-history.js','web/history-cfb.json','web/history-nfl.json']) hashes[file] = sha(await readFile(resolve(root, file)));
const histories = Object.fromEntries(await Promise.all(['cfb','nfl'].map(async league => [league, JSON.parse(await readFile(resolve(root, `web/history-${league}.json`), 'utf8'))])));
const results = [];
const journalResults = [];
for (const file of journalFiles) {
 const value = await readFile(file, 'utf8'), game = JSON.parse(value);
 await writeFile(resolve(dir, 'journal-' + game.key.replace(':', '-') + '.json'), value);
 let review = null;
 try { review = JSON.parse(await readFile(resolve(root, 'web/reviews/' + game.key.replace(':', '-') + '.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
 journalResults.push({key:game.key,meta:game.meta,createdAt:game.createdAt,updatedAt:game.updatedAt,sourceSha256:sha(value),sourceCount:game.sources.length,releaseCount:game.releases.length,audit:journalAudit.auditGame(game, review, histories[game.meta.league])});
}
for (const [league, gameId, selectionReason] of sample) {
 const url = `https://site.api.espn.com/apis/site/v2/sports/football/${league === 'cfb' ? 'college-football' : 'nfl'}/summary?event=${gameId}`;
 const cache = resolve(dir, `${league}-${gameId}.json`);
 let record;
 try { if (refresh) throw Object.assign(Error(), {code:'ENOENT'}); record = JSON.parse(await readFile(cache, 'utf8')); }
 catch (e) { if (e.code !== 'ENOENT') throw e; const response = await fetch(url); if (!response.ok) throw Error(`${gameId}: HTTP ${response.status}`); record = {url, retrievedAt:new Date().toISOString(), data:await response.json()}; await writeFile(cache, JSON.stringify(record,null,2)+'\n'); }
 const source = record.data, header = source.header, competition = header.competitions[0];
 if (String(header.id) !== gameId || competition.status.type.state !== 'post' || !competition.status.type.completed || source.drives.current) throw Error(`${gameId}: not complete final drives`);
 const label = competition.competitors.slice().sort((a,b)=>a.homeAway==='away'?-1:1).map(c=>c.team.displayName).join(' at ');
 const raw = source.drives.previous.flatMap(d => (d.plays||[]).map(p => ({...p, id:String(p.id), driveId:String(d.id)})));
 const positions = new Map(), plays = [];
 for (const p of raw) { if (!p.id || !p.driveId) throw Error('Missing source key'); if (positions.has(p.id)) plays[positions.get(p.id)] = p; else {positions.set(p.id,plays.length);plays.push(p);} }
 const model = replay.prepare({schemaVersion:1,kind:'football-replay',gameId,league,label,playedAt:competition.date,sourceUrl:url,retrievedAt:record.retrievedAt,sourceStatus:'final',sourceNote:'Reconstructed from final ESPN reports; live revisions and release times unknown.',season:header.season,teams:competition.competitors.map(c=>({id:String(c.id),homeAway:c.homeAway,team:c.team})),plays,initialAfterPlayId:plays.find(p=>!context.isMarker(p)).id,momentSpecs:[{label:'Start',count:0},{label:'Final',count:plays.length}]});
 const abbr = Object.fromEntries(model.teams.map(t=>[String(t.id),t.team.abbreviation]));
 const all = insights.summarize(plays,{teamAbbreviations:abbr});
 const actionIds = new Set(all.teams.flatMap(t=>t.playIds));
 const rows = [], recent = [];
 context.st.gameId = gameId;
 let previous = null;
 for (const count of model.steps.slice(1)) {
  const prefix = model.plays.slice(0,count), p = prefix.at(-1);
  const snap = replay.snapshot(model,count);
  const situation = context.preSnap(snap,prefix,null);
  const summary = insights.summarize(prefix,{teamAbbreviations:abbr});
  const evidence = insights.forRead(summary,gameId);
  const past = history.lookup(histories[league],situation,league);
  const candidates = reads.candidates(situation,evidence,past);
  const chosen = reads.select(situation,evidence,recent,past);
  const cold = reads.select(situation,evidence,[],past);
  const detail = facts.describe(p,abbr);
  const focus = chosen?.focus;
  const sameName = !!focus && previous?.focus?.name === focus.name && situation.offenseTeam.id === previous.situation?.offenseTeam.id;
  const wording = chosen ? JSON.stringify([chosen.headline,chosen.detail,chosen.watch]) : null;
  const team = evidence.teams.find(t=>t.teamId===situation?.offenseTeam?.id);
  const involvement = focus ? (focus.role==='runner' ? team?.runners.find(r=>r.name===focus.name)?.playIds : team?.receivers.find(r=>r.name===focus.name)?.playIds)||[] : [];
  const row = {count,playId:p.id,type:p.type.text,period:p.period?.number,clock:p.clock?.displayValue,isOffensiveAction:actionIds.has(p.id),situation:situation?JSON.parse(JSON.stringify(situation)):null,readId:chosen?.id||null,key:chosen?.key||null,priority:chosen?.priority||null,focus:focus||null,headline:chosen?.headline||'',detail:chosen?.detail||'',watch:chosen?.watch||'',playIds:chosen?.playIds||[],candidateIds:candidates.map(c=>c.id),samePlayerAsPreviousStep:sameName,sameWordingAsPreviousStep:!!wording&&wording===previous?.wording,samePlayerWithoutNewInvolvement:sameName&&JSON.stringify(involvement)===JSON.stringify(previous.involvement),coldSelectionDiffers:chosen?.key!==cold?.key,takeaway:detail.takeaway||'',gameSummary:detail.gameSummary||'',gameConsequence:detail.gameConsequence||'',raw:detail.raw,kind:detail.kind};
  if (row.playIds.some(id=>!prefix.some(p=>p.id===id))) throw Error('Future support ID');
  if (chosen && chosen.priority !== candidates[0].priority) throw Error('Stale lower priority selection');
  rows.push(row);recent.push(chosen?.key||'quiet');
  previous={...row,wording,involvement};
 }
 const selected = rows.filter(r=>r.readId), player = selected.filter(r=>r.focus), actions = rows.filter(r=>r.isOffensiveAction);
 const streaks=[];let run=[];
 for(const row of rows){if(row.focus&&run.length&&row.focus.name===run.at(-1).focus.name&&row.situation.offenseTeam.id===run.at(-1).situation.offenseTeam.id)run.push(row);else{if(run.length)streaks.push(run);run=row.focus?[row]:[];}}if(run.length)streaks.push(run);
 const contextualIds = ['third_down_distance','second_long','goal_to_go','long_thirds'];
 const longest = streaks.sort((a,b)=>b.length-a.length)[0]||[];
 results.push({league,gameId,label,playedAt:competition.date,selectionReason,sourceUrl:url,retrievedAt:record.retrievedAt,sourceSha256:sha(JSON.stringify(source)),summary:{rawReports:raw.length,uniqueReports:plays.length,duplicateIdsReplaced:raw.length-plays.length,markers:plays.filter(p=>context.isMarker(p)).length,replaySteps:rows.length,offensiveActionSteps:actions.length,validSituationSteps:rows.filter(r=>r.situation&&reads.valid(r.situation)).length,selectedReadSteps:selected.length,quietInvalidSteps:rows.filter(r=>!r.readId&&!(r.situation&&reads.valid(r.situation))).length,quietValidSteps:rows.filter(r=>!r.readId&&r.situation&&reads.valid(r.situation)).length,playerReadSteps:player.length,receiverReadSteps:player.filter(r=>r.focus.role==='receiver').length,runnerReadSteps:player.filter(r=>r.focus.role==='runner').length,playerSameWordingAsPreviousStep:player.filter(r=>r.sameWordingAsPreviousStep).length,playerOutranksOrdinaryContext:player.filter(r=>r.candidateIds.some(id=>contextualIds.includes(id))).length,runnerOnLongThird:player.filter(r=>r.focus.role==='runner'&&r.situation.down===3&&r.situation.distance>=7).length,samePlayerAsPreviousStep:player.filter(r=>r.samePlayerAsPreviousStep).length,samePlayerWithoutNewInvolvement:player.filter(r=>r.samePlayerWithoutNewInvolvement).length,sameWordingAsPreviousStep:selected.filter(r=>r.sameWordingAsPreviousStep).length,coldSelectionDifferences:rows.filter(r=>r.coldSelectionDiffers).length,takeawayActionSteps:actions.filter(r=>r.takeaway).length,consequenceActionSteps:actions.filter(r=>r.gameConsequence).length,longestSamePlayerStreak:{name:longest[0]?.focus.name||null,steps:longest.length,playIds:longest.map(r=>r.playId)},readCounts:Object.fromEntries([...new Set(selected.map(r=>r.readId))].map(id=>[id,selected.filter(r=>r.readId===id).length]))},coverage:all.teams.map(t=>({team:t.team,actions:t.actions,coverage:t.coverage,thirdDowns:t.thirdDowns})),rows});
 console.log(`${league} ${gameId}: ${rows.length} steps, ${player.length} player reads, ${player.filter(r=>r.samePlayerWithoutNewInvolvement).length} consecutive unchanged involvement`);
}
await mkdir(resolve(out,'..'),{recursive:true});
await writeFile(out,JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),kind:'reconstructed-final-report-prefix-audit',selectorVersion:reads.version,hashes,samplePolicy:'Purposive sample: six recent college finals spanning Sept7/Thursday/Friday/Saturday, score margins and offense styles; both NFL finals returned in Sept7-12 window. Selected before inspecting selector outputs, not random or representative.',method:'All replay action steps plus final step; original drive boundaries, current replay snapshot, extracted current app preSnap whitelist, current Insights/forRead/History/Read. Sequential recent keys; cold reset compared because the replay UI resets at every seek. No browser timing, queues, actual viewing, future start blocks or final boxscore input.',journalResults,results},null,2)+'\n');
console.log(out);

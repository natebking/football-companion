// node scripts/audit-journals.mjs --out data/journal-audit.json journal1.json journal2.json
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import audit from '../engine/journal_audit.js';
const args = process.argv.slice(2), files = [];
let output = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') output = args[++i];
  else if (args[i].startsWith('--')) throw new Error('Unknown argument: ' + args[i]);
  else files.push(args[i]);
}
if (!files.length) throw new Error('Pass one or more downloaded journal JSON files. Optionally use --out path.');
const results = [], keys = new Set();
for (const file of files) {
  const game = JSON.parse(await readFile(file, 'utf8'));
  if (keys.has(game.key)) throw new Error('Duplicate game journal: ' + game.key + '. Use one complete export per game.');
  keys.add(game.key);
  if (!/^(cfb|nfl):\d+$/.test(game.key)) throw new Error('Invalid journal game key');
  let review = null;
  try { review = JSON.parse(await readFile(resolve(import.meta.dirname, '../web/reviews', game.key.replace(':', '-') + '.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const history = JSON.parse(await readFile(resolve(import.meta.dirname, '../web/history-' + game.meta.league + '.json'), 'utf8'));
  results.push(audit.auditGame(game, review, history));
}
const report = JSON.stringify({ schemaVersion: 1, games: results.length, results }, null, 2) + '\n';
if (output) { await writeFile(output, report); console.log('Audited ' + results.length + ' journal(s): ' + output); }
else process.stdout.write(report);

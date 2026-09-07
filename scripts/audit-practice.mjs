// Audit one voluntary browser export. Keep private inputs/results in ignored data/.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import audit from '../engine/practice_audit.js';
const args = process.argv.slice(2);
let bankPath = new URL('../web/teaching-examples.json', import.meta.url), output = null, file = null, origin = 'unspecified';
for (let i = 0; i < args.length; i++) {
  if (['--bank', '--out', '--origin'].includes(args[i])) {
    const flag = args[i], value = args[++i];
    if (!value || value.startsWith('--')) throw Error('Missing value for ' + flag);
    if (flag === '--bank') bankPath = value;
    else if (flag === '--out') output = value;
    else origin = value;
  } else if (args[i].startsWith('--')) throw Error('Unknown argument: ' + args[i]);
  else if (file) throw Error('Use one complete browser export per audit; exports do not identify unique viewers.');
  else file = args[i];
}
if (!file || !['unspecified', 'viewer', 'qa'].includes(origin)) throw Error('Usage: node scripts/audit-practice.mjs [--bank path] [--out path] [--origin viewer|qa] football-practice.json');
const bytes = await readFile(file), bankBytes = await readFile(bankPath);
const sha = b => createHash('sha256').update(b).digest('hex');
const report = audit.auditPractice(JSON.parse(bytes), JSON.parse(bankBytes));
report.declaredOrigin = origin;
report.provenance = { exportSha256: sha(bytes), bankFileSha256: sha(bankBytes),
  auditCodeSha256: sha(await readFile(new URL('../engine/practice_audit.js', import.meta.url))) };
const text = JSON.stringify(report, null, 2) + '\n';
if (output) { await writeFile(output, text); console.log(JSON.stringify(report.summary, null, 2)); }
else process.stdout.write(text);

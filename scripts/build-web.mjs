// Build the static site and fingerprint the exact artifacts used in a journal.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const source = join(root, 'web'), output = join(root, '.vercel-build');
const hash = value => createHash('sha256').update(value).digest('hex');
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))).flat();
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
await cp(join(root, 'index.html'), join(output, 'stopwatch.html'));
const files = {};
for (const file of (await walk(source)).sort()) files[relative(source, file)] = hash(await readFile(file));
await writeFile(join(output, 'build-info.json'), JSON.stringify({ schemaVersion: 1, id: hash(JSON.stringify(files)), files }));
console.log('Built static site with SHA-256 artifact manifest.');

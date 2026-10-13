// Every dependency must be pinned to an exact version (no ^ ~ ranges, no "latest"). Workspace links are fine.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const roots = [
  '.',
  ...['apps', 'packages', 'tools'].flatMap((d) =>
    existsSync(d) ? readdirSync(d).map((n) => join(d, n)) : [],
  ),
];
const bad = [];
for (const dir of roots) {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (
        typeof range === 'string' &&
        !range.startsWith('workspace:') &&
        !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(range)
      ) {
        bad.push(`${file}: ${field}.${name} = "${range}"`);
      }
    }
  }
}
if (bad.length) {
  console.error(`Unpinned dependencies:\n- ${bad.join('\n- ')}`);
  process.exit(1);
}
console.log('All dependencies are pinned.');

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { assertSafeApiUrl, createClient } from './client.js';
import { parseManifest } from './manifest.js';
import { buildReport, formatReport } from './report.js';
import { runEval } from './run.js';

const USAGE = `Usage: pnpm --filter @audion/eval eval --manifest test.jsonl --clips ./clips --api http://localhost:8080
  --manifest     labelled list (Vertex tuning JSONL, or {"clip","label"} lines)
  --clips        folder holding the clip files (looked up by file name)
  --api          API under test. Clips are sent ONLY here; https required except localhost
  --concurrency  requests in flight (default 4)
  --limit        evaluate only the first N clips
  --json         also write the full report to this file`;

async function main() {
  // pnpm forwards a literal `--` when users type `pnpm eval -- --flag`; ignore it.
  const args = process.argv.slice(2).filter((a, i) => !(a === '--' && i === 0));
  const { values } = parseArgs({
    args,
    options: {
      manifest: { type: 'string' },
      clips: { type: 'string' },
      api: { type: 'string' },
      concurrency: { type: 'string', default: '4' },
      limit: { type: 'string' },
      json: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || !values.manifest || !values.clips || !values.api) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 2);
  }
  assertSafeApiUrl(values.api);

  const { items: all, errors } = parseManifest(
    await readFile(values.manifest, 'utf8'),
    values.clips,
  );
  for (const e of errors) console.error(`skipped: ${e}`);
  const items = values.limit ? all.slice(0, Number(values.limit)) : all;
  if (!items.length) throw new Error('No usable clips in the manifest.');

  // Say which kind of API this is: a mock's accuracy means nothing.
  const mode = await fetch(new URL('/healthz', values.api))
    .then((r) => r.json() as Promise<{ mode?: string }>)
    .then((h) => h.mode)
    .catch(() => undefined);
  console.log(`API: ${values.api}  mode: ${mode ?? 'unreachable'}`);
  if (mode === 'mock') {
    console.log(
      'WARNING: this API is in MOCK mode. It returns scripted answers, so the accuracy below is meaningless.\n',
    );
  }

  const client = createClient({ baseUrl: values.api });
  const missing: string[] = [];
  const results = await runEval(
    items,
    async (item) => {
      let bytes: Buffer;
      try {
        bytes = await readFile(item.path); // read, sent to the API under test, never copied anywhere
      } catch {
        missing.push(item.path);
        return { ok: false as const, code: 'CLIP_NOT_FOUND', message: item.path };
      }
      return client.recognize(bytes, item.mime);
    },
    Math.max(1, Number(values.concurrency)),
    (done, total) => process.stderr.write(`\r${done}/${total} clips`),
  );
  process.stderr.write('\n');

  const report = buildReport(results);
  console.log(formatReport(report));
  if (missing.length)
    console.error(`\n${missing.length} clip file(s) not found, e.g. ${missing[0]}`);
  if (values.json) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(values.json, JSON.stringify(report, null, 2));
  }
}

main().catch((e: Error) => {
  console.error(`eval failed: ${e.message}`);
  process.exit(1);
});

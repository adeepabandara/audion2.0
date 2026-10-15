/**
 * Score a recognizer on a local folder of clips laid out as <SIGN>/<file>.mp4 and write results.csv.
 * Dev only. Every clip is a paid call, so it prints how many calls it will make and needs --yes.
 *
 *   # compare checkpoints: same clips, different endpoint
 *   pnpm --filter @audion/api eval --clips ./test-clips --endpoint <endpoint-id> --yes
 *   # reproduce the untuned baseline (26.2% on 440 clips: 20 per sign)
 *   pnpm --filter @audion/api eval --clips ./test-clips --mode base --limit-per-sign 20 --yes
 *   # free dry run of the pipeline
 *   pnpm --filter @audion/api eval --clips ./test-clips --mode mock
 *
 * Flags: --clips <dir> (required)  --limit-per-sign N (default 5)  --mode tuned|base|mock  --endpoint <id>
 *        --out results.csv  --baseline 0.262  --yes
 *
 * The clips are NOT in the repo: copy a small sample of the held-out test split (popsign_v1_0/raw/<SIGN>/test/ in
 * the private bucket) to a local folder with your own credentials. Never commit them.
 */
import { SIGNS } from '@audion/shared';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatSummary, summarize, toCsv, type EvalRow } from '../src/evalReport.js';
import { AppError } from '../src/errors.js';
import { createRecognizer } from '../src/services/index.js';
import { DEFAULT_COUNT_FILE, fileCountStore } from './countStore.js';
import { loadConfigOrExit, mimeFor, parseArgs, str } from './args.js';

const { flags } = parseArgs(process.argv.slice(2));
const clipsDir = str(flags.get('clips'));
if (!clipsDir) {
  console.error(
    'Usage: eval --clips <dir of SIGN/file.mp4> [--limit-per-sign N] [--mode tuned|base|mock] [--endpoint <id>] [--yes]',
  );
  process.exit(2);
}
const limit = Number(str(flags.get('limit-per-sign')) ?? 5);
if (!Number.isInteger(limit) || limit < 1) {
  console.error('--limit-per-sign must be a whole number of at least 1');
  process.exit(2);
}
const endpoint = str(flags.get('endpoint'));
const mode =
  str(flags.get('mode')) ?? (endpoint ? 'tuned' : (process.env.RECOGNIZER_MODE ?? 'tuned'));
if (mode !== 'tuned' && mode !== 'base' && mode !== 'mock') {
  console.error('--mode must be tuned, base or mock');
  process.exit(2);
}
const baseline = Number(str(flags.get('baseline')) ?? 0.262);
const outPath = str(flags.get('out')) ?? 'results.csv';

const config = loadConfigOrExit({
  ...process.env,
  RECOGNIZER_MODE: mode,
  ...(endpoint ? { TUNED_ENDPOINT_ID: endpoint } : {}),
});

// Collect the clips: first `limit` files (sorted, so runs are repeatable) from each sign folder.
const vocabulary = new Set<string>(SIGNS);
const clips: Array<{ truth: string; file: string; path: string; mime: string }> = [];
for (const dir of readdirSync(clipsDir).sort()) {
  const full = join(clipsDir, dir);
  if (!statSync(full).isDirectory()) continue;
  const truth = dir.toLowerCase().replace(/[^a-z]/g, '');
  if (!vocabulary.has(truth)) {
    console.warn(`Skipping folder "${dir}": not one of the 22 signs.`);
    continue;
  }
  const files = readdirSync(full)
    .filter((f) => mimeFor(f))
    .sort()
    .slice(0, limit);
  for (const f of files)
    clips.push({ truth, file: `${dir}/${f}`, path: join(full, f), mime: mimeFor(f)! });
}
if (clips.length === 0) {
  console.error(`No clips found under ${clipsDir}. Expected <SIGN>/<file>.mp4 (or .webm/.mov).`);
  process.exit(2);
}

const label =
  mode === 'tuned'
    ? `tuned endpoint ${config.recognizer.tunedEndpointId}`
    : mode === 'base'
      ? `base model ${config.recognizer.baseModel}`
      : 'mock (no cloud calls)';
console.log(`Recognizer:  ${label}`);
console.log(
  `Clips:       ${clips.length} (${new Set(clips.map((c) => c.truth)).size} signs, up to ${limit} each)`,
);
if (mode !== 'mock') {
  console.log(
    `Paid calls:  ${clips.length}, each billed by Vertex AI. Daily cap: ${config.recognizer.dailyCallCap}.`,
  );
  if (!flags.has('yes')) {
    console.log('\nNothing was sent. Re-run with --yes to start.');
    process.exit(0);
  }
}

const recognizer = createRecognizer(
  config,
  undefined,
  (m) => console.warn(m),
  fileCountStore(DEFAULT_COUNT_FILE),
);
const rows: EvalRow[] = [];
for (const [i, c] of clips.entries()) {
  const started = Date.now();
  try {
    const r = await recognizer.recognize({ clip: readFileSync(c.path), mime: c.mime });
    rows.push({
      file: c.file,
      truth: c.truth,
      predicted: r.sign,
      confidence: r.confidence,
      latencyMs: Date.now() - started,
    });
  } catch (e) {
    const code = e instanceof AppError ? e.code : 'ERROR';
    rows.push({
      file: c.file,
      truth: c.truth,
      predicted: 'unknown',
      confidence: null,
      latencyMs: Date.now() - started,
      error: code,
    });
    if (code === 'DAILY_CAP_REACHED') {
      console.error(`\nDaily call cap reached after ${i} clips; stopping. Partial results follow.`);
      break;
    }
  }
  if ((i + 1) % 10 === 0 || i + 1 === clips.length)
    process.stderr.write(`  ${i + 1}/${clips.length}\r`);
}

writeFileSync(outPath, toCsv(rows));
console.log(
  `\n\n${formatSummary(summarize(rows), mode === 'tuned' || mode === 'base' ? baseline : undefined)}`,
);
console.log(`\nWrote ${outPath}. Model: ${recognizer.modelId}. Calls made: ${rows.length}.`);

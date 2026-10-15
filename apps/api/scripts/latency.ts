/**
 * Where does the recognition time go? Runs the same request in a few shapes and prints how long each takes:
 * tuned endpoint vs base model, with the clip vs prompt only (no video), first call vs warm calls.
 * Paid calls: 4 shapes x --repeat (default 2) = 8 by default, a few cents. Needs --yes.
 *
 *   TUNED_ENDPOINT_ID=<id> GOOGLE_CLOUD_QUOTA_PROJECT=<project> pnpm --filter @audion/api latency --clip ./hello.mp4 --yes
 */
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { readFileSync } from 'node:fs';
import { DailyCallCap } from '../src/services/callCap.js';
import { recognizeRequest } from '../src/services/live/recognizer.js';
import { answerText } from '../src/services/live/recognizer.js';
import { DEFAULT_COUNT_FILE, fileCountStore } from './countStore.js';
import { loadConfigOrExit, mimeFor, parseArgs, str, vertexHost } from './args.js';

const { flags } = parseArgs(process.argv.slice(2));
const clipPath = str(flags.get('clip'));
const mime = clipPath ? mimeFor(clipPath) : undefined;
if (!clipPath || !mime) {
  console.error(
    'Usage: latency --clip <file.mp4|webm> [--endpoint <id>] [--repeat N] [--thinking minimal|low|medium|high|off] [--only tuned|base] [--parallel N] --yes',
  );
  process.exit(2);
}
const repeat = Number(str(flags.get('repeat')) ?? 2);
const thinking = (str(flags.get('thinking')) ?? 'minimal').toUpperCase();
const thinkingOff = thinking === 'OFF'; // models without thinking levels (e.g. Gemini 2.5): send no thinkingConfig
const only = str(flags.get('only'));
const parallel = Number(str(flags.get('parallel')) ?? 0);
if (
  (!thinkingOff && !(thinking in ThinkingLevel)) ||
  !Number.isInteger(repeat) ||
  repeat < 1 ||
  repeat > 5 ||
  (only !== undefined && only !== 'tuned' && only !== 'base')
) {
  console.error(
    '--repeat must be 1-5, --thinking one of minimal, low, medium, high, off, and --only tuned or base',
  );
  process.exit(2);
}
const endpoint = str(flags.get('endpoint'));
const config = loadConfigOrExit({
  ...process.env,
  RECOGNIZER_MODE: 'tuned',
  ...(endpoint ? { TUNED_ENDPOINT_ID: endpoint } : {}),
});
const r = config.recognizer;
const clip = readFileSync(clipPath).toString('base64');

const allShapes = [
  {
    name: 'tuned (us), with clip',
    location: r.tunedLocation,
    model: `projects/${config.gcpProject}/locations/${r.tunedLocation}/endpoints/${r.tunedEndpointId}`,
    video: true,
  },
  {
    name: 'tuned (us), prompt only',
    location: r.tunedLocation,
    model: `projects/${config.gcpProject}/locations/${r.tunedLocation}/endpoints/${r.tunedEndpointId}`,
    video: false,
  },
  {
    name: `base ${r.baseModel} (global), with clip`,
    location: r.baseLocation,
    model: r.baseModel,
    video: true,
  },
  {
    name: `base ${r.baseModel} (global), prompt only`,
    location: r.baseLocation,
    model: r.baseModel,
    video: false,
  },
];

const shapes = allShapes.filter((s) => !only || s.name.startsWith(only));

console.log(
  `clip: ${clipPath} (${((clip.length * 0.75) / 1024).toFixed(0)} KB), thinking: ${thinking}, ${repeat} call(s) per shape`,
);
console.log(`paid calls: ${shapes.length * repeat}`);
if (!flags.has('yes')) {
  console.log('\nNothing was sent. Re-run with --yes to start.');
  process.exit(0);
}

const cap = new DailyCallCap(r.dailyCallCap, fileCountStore(DEFAULT_COUNT_FILE));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
console.log('\nshape'.padEnd(52) + 'host'.padEnd(40) + 'ms per call (first is cold)  answer');
for (const s of shapes) {
  const client = new GoogleGenAI({
    vertexai: true,
    project: config.gcpProject,
    location: s.location,
  });
  const times: number[] = [];
  let last = '';
  for (let i = 0; i < repeat; i++) {
    cap.take();
    const req = recognizeRequest(
      s.model,
      clip,
      mime,
      r.maxOutputTokens,
      false,
      AbortSignal.timeout(90_000),
      thinkingOff ? undefined : thinking.toLowerCase(),
    );
    if (!s.video) (req.contents as Array<{ parts: unknown[] }>)[0]!.parts.shift(); // keep only the text prompt
    const t0 = Date.now();
    try {
      const res = await client.models.generateContent(req);
      last = JSON.stringify(answerText(res).trim()).slice(0, 24);
    } catch (e) {
      last = `ERROR ${(e as { status?: number }).status ?? ''} ${String((e as Error).message)
        .replace(/\s+/g, ' ')
        .slice(0, 260)}`;
    }
    times.push(Date.now() - t0);
  }
  console.log(
    `${s.name.padEnd(52)}${vertexHost(s.location).padEnd(40)}${times.join(', ').padEnd(28)} ${last}  (median ${median(times)})`,
  );
}

if (parallel > 1) {
  console.log(
    `\nSame request sent ${parallel} times at once (does asking twice help when one is slow?):`,
  );
  for (const s of shapes) {
    const client = new GoogleGenAI({
      vertexai: true,
      project: config.gcpProject,
      location: s.location,
    });
    const run = async () => {
      cap.take();
      const req = recognizeRequest(
        s.model,
        clip,
        mime,
        r.maxOutputTokens,
        false,
        AbortSignal.timeout(120_000),
        thinkingOff ? undefined : thinking.toLowerCase(),
      );
      if (!s.video) (req.contents as Array<{ parts: unknown[] }>)[0]!.parts.shift();
      const t0 = Date.now();
      try {
        await client.models.generateContent(req);
      } catch {
        return -1;
      }
      return Date.now() - t0;
    };
    const times = (await Promise.all(Array.from({ length: parallel }, run))).sort((a, b) => a - b);
    console.log(
      `${s.name.padEnd(52)} ${times.join(', ')} ms   fastest ${times[0]}, slowest ${times[times.length - 1]}`,
    );
  }
}

console.log(`\npaid calls today: ${cap.used} of ${r.dailyCallCap}`);

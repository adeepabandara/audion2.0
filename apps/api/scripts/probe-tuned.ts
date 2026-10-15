/**
 * Send ONE short clip to the recognizer and print the raw response, to confirm the request shape works before
 * relying on it. Costs one paid call. Nothing is stored; the clip is read from the path you give and sent inline.
 *
 *   gcloud auth application-default login
 *   TUNED_ENDPOINT_ID=<numeric id> pnpm --filter @audion/api probe --clip ./hello.mp4
 *   pnpm --filter @audion/api probe --clip ./hello.mp4 --mode base      # the untuned model, for comparison
 */
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { readFileSync } from 'node:fs';
import { DailyCallCap } from '../src/services/callCap.js';
import { parseAnswer } from '../src/services/live/answer.js';
import { answerText, recognizeRequest } from '../src/services/live/recognizer.js';
import { DEFAULT_COUNT_FILE, fileCountStore } from './countStore.js';
import { loadConfigOrExit, mimeFor, parseArgs, str, vertexHost } from './args.js';

const { flags } = parseArgs(process.argv.slice(2));
const clipPath = str(flags.get('clip'));
if (!clipPath) {
  console.error(
    'Usage: probe --clip <file.mp4|webm> [--mode tuned|base] [--endpoint <numeric id>] [--no-logprobs] [--thinking minimal|low|medium|high]',
  );
  process.exit(2);
}
const mime = mimeFor(clipPath);
if (!mime) {
  console.error('The clip must be .mp4, .webm or .mov');
  process.exit(2);
}

const endpoint = str(flags.get('endpoint'));
const mode =
  str(flags.get('mode')) ?? (endpoint ? 'tuned' : (process.env.RECOGNIZER_MODE ?? 'tuned'));
if (mode !== 'tuned' && mode !== 'base') {
  console.error('--mode must be tuned or base');
  process.exit(2);
}
const config = loadConfigOrExit({
  ...process.env,
  RECOGNIZER_MODE: mode,
  ...(endpoint ? { TUNED_ENDPOINT_ID: endpoint } : {}),
});
const r = config.recognizer;
const location = mode === 'tuned' ? r.tunedLocation : r.baseLocation;
const model =
  mode === 'tuned'
    ? `projects/${config.gcpProject}/locations/${r.tunedLocation}/endpoints/${r.tunedEndpointId}`
    : r.baseModel;

const clip = readFileSync(clipPath);
const request = recognizeRequest(model, clip.toString('base64'), mime, r.maxOutputTokens, true);

console.log('--- request (clip bytes omitted) ---');
console.log(`host:      https://${vertexHost(location)}/`);
console.log(`project:   ${config.gcpProject}`);
console.log(`location:  ${location}`);
console.log(`model:     ${model}`);
console.log(`clip:      ${clipPath} (${mime}, ${clip.length} bytes)`);
console.log(
  `prompt:    ${JSON.stringify((request.contents as never as Array<{ parts: Array<{ text?: string }> }>)[0]!.parts[1]!.text)}`,
);
console.log(`config:    ${JSON.stringify({ ...request.config, abortSignal: undefined })}`);

const cap = new DailyCallCap(r.dailyCallCap, fileCountStore(DEFAULT_COUNT_FILE));

const client = new GoogleGenAI({ vertexai: true, project: config.gcpProject, location });
const started = Date.now();

const thinkingFlag = str(flags.get('thinking'))?.toUpperCase();
if (thinkingFlag && !(thinkingFlag in ThinkingLevel)) {
  console.error('--thinking must be minimal, low, medium or high');
  process.exit(2);
}
const thinking = thinkingFlag as ThinkingLevel | undefined;
if (thinking) console.log(`thinking:  ${thinking} (experiment: not part of the server config)`);

/** One call, with or without logprobs. Counts against the daily cap like any paid call. */
async function send(withLogprobs: boolean) {
  cap.take();
  const req = recognizeRequest(
    model,
    clip.toString('base64'),
    mime!,
    r.maxOutputTokens,
    withLogprobs,
  );
  return client.models.generateContent({
    ...req,
    config: {
      ...req.config,
      ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}),
      abortSignal: AbortSignal.timeout(r.timeoutMs),
    },
  });
}

try {
  let logprobsSupported = true;
  let res;
  try {
    if (flags.has('no-logprobs')) {
      logprobsSupported = false; // already known: skip the request that gets refused
      res = await send(false);
    } else res = await send(true);
  } catch (e) {
    // The tuned model may refuse logprobs; that is a finding, not a failure. Ask again without them.
    if (!/logprob/i.test(String((e as Error).message))) throw e;
    logprobsSupported = false;
    console.log(`First call (with logprobs) was refused: ${(e as Error).message.slice(0, 160)}`);
    console.log('Retrying without logprobs...\n');
    res = await send(false);
  }
  const cand = res.candidates?.[0];
  console.log(`--- response (${Date.now() - started} ms) ---`);
  console.log(`modelVersion:  ${res.modelVersion ?? '(none)'}`);
  console.log(`finishReason:  ${cand?.finishReason ?? '(none)'}`);
  console.log(`usage:         ${JSON.stringify(res.usageMetadata ?? {})}`);
  console.log(`parts:         ${JSON.stringify(cand?.content?.parts ?? [])}`);
  const lp = cand?.logprobsResult;
  console.log(
    `logprobs:      ${
      !logprobsSupported
        ? 'not available (refused by this endpoint, or skipped with --no-logprobs), so confidence is null'
        : lp?.chosenCandidates?.length
          ? `yes (${lp.chosenCandidates.length} tokens; top candidates at the first token: ${JSON.stringify(
              lp.topCandidates?.[0]?.candidates?.map((c) => [
                c.token,
                Number(Math.exp(c.logProbability ?? -Infinity).toFixed(3)),
              ]),
            )})`
          : 'accepted, but none returned'
    }`,
  );
  const text = answerText(res).trim();
  console.log(`\nanswer text:   ${JSON.stringify(text)}`);
  console.log(`parsed sign:   ${JSON.stringify(parseAnswer(text))}`);
  console.log(`(paid calls today: ${cap.used} of ${r.dailyCallCap})`);
} catch (e) {
  const err = e as { status?: number; message?: string };
  console.error(
    `\nCall failed after ${Date.now() - started} ms: HTTP ${err.status ?? '?'}: ${err.message}`,
  );
  if (err.status === 404) {
    console.error(
      'A 404 usually means the endpoint ID or location is wrong, or the tuned model is not served on this host.',
    );
  }
  process.exit(1);
}

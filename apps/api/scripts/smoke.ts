// Checks a deployed Ola site end to end without a camera: page, health, session, sentence, voice.
// Costs a few cheap calls (no sign recognition, so no tuned-model call). Usage:
//   pnpm --filter @audion/api smoke https://YOUR-SERVICE-URL
import { parseArgs } from './args.js';

const base = parseArgs(process.argv.slice(2)).rest[0]?.replace(/\/$/, '');
if (!base) {
  console.error('Usage: pnpm --filter @audion/api smoke https://SERVICE_URL');
  process.exit(2);
}

let failed = 0;
async function check(name: string, run: () => Promise<string>): Promise<void> {
  const t = Date.now();
  try {
    console.log(`ok    ${name} (${Date.now() - t} ms) ${await run()}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}: ${(e as Error).message}`);
  }
}
const need = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};
const headers = { origin: base, 'content-type': 'application/json' };

let token = '';
await check('page', async () => {
  const r = await fetch(`${base}/`);
  const html = await r.text();
  need(r.ok && html.includes('Ola'), `status ${r.status}, no Ola page (is WEB_DIR set?)`);
  return '';
});
await check('tracker, hand model and wasm', async () => {
  for (const p of [
    'tracker.html',
    'models/hand_landmarker.task',
    'wasm/vision_wasm_internal.wasm',
  ]) {
    const r = await fetch(`${base}/${p}`, { method: 'HEAD' });
    need(r.ok, `${p} -> ${r.status}`);
  }
  return '';
});
await check('health', async () => {
  const h = (await (await fetch(`${base}/v1/health`)).json()) as {
    mode?: string;
    modelId?: string;
  };
  need(h.mode === 'live', `mode is ${h.mode}, expected live (MOCK=0)`);
  return `${h.mode} ${h.modelId}`;
});
await check('session', async () => {
  const r = await fetch(`${base}/v1/session`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ installId: crypto.randomUUID() }),
  });
  need(r.ok, `status ${r.status}`);
  token = ((await r.json()) as { token: string }).token;
  return '';
});
const authed = () => ({ ...headers, authorization: `Bearer ${token}` });
await check('compose (two signs, Gemini)', async () => {
  const r = await fetch(`${base}/v1/compose`, {
    method: 'POST',
    headers: authed(),
    body: JSON.stringify({ signs: ['hello', 'please'] }),
  });
  need(r.ok, `status ${r.status}`);
  return `"${((await r.json()) as { sentence?: string }).sentence}"`;
});
await check('translate (Gemini, Spanish)', async () => {
  const r = await fetch(`${base}/v1/translate`, {
    method: 'POST',
    headers: authed(),
    body: JSON.stringify({ text: 'Hello, please wait.', language: 'es' }),
  });
  need(r.ok, `status ${r.status}`);
  const text = ((await r.json()) as { text?: string }).text ?? '';
  need(text.length > 0 && !text.includes('test mode'), `no real translation: "${text}"`);
  return `"${text}"`;
});
await check('speak a translation (Google TTS, Spanish)', async () => {
  const r = await fetch(`${base}/v1/speak`, {
    method: 'POST',
    headers: authed(),
    body: JSON.stringify({
      text: 'Hola, por favor espera.',
      voiceId: 'aria',
      speed: 1,
      language: 'es',
    }),
  });
  const bytes = (await r.arrayBuffer()).byteLength;
  need(r.ok && bytes > 1000, `status ${r.status}, ${bytes} bytes`);
  return `${bytes} bytes`;
});
await check('speak (Google TTS)', async () => {
  const r = await fetch(`${base}/v1/speak`, {
    method: 'POST',
    headers: authed(),
    body: JSON.stringify({ text: 'Hello from Ola.', voiceId: 'aria', speed: 1 }),
  });
  const bytes = (await r.arrayBuffer()).byteLength;
  need(r.ok && bytes > 1000, `status ${r.status}, ${bytes} bytes`);
  return `${bytes} bytes`;
});

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);

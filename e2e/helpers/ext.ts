import {
  test as base,
  chromium,
  expect,
  type BrowserContext,
  type Page,
  type Request,
} from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_PAUSE_MS } from '../../packages/shared/src/constants';
import { makeFrames, type Segment } from '../../apps/extension/src/testing/fixtures';

export const EXT_DIR = resolve(import.meta.dirname, '../../apps/extension/.output/chrome-mv3');
export const FAKE_MEET = 'http://localhost:4173/';
export const API_ORIGIN = 'http://localhost:8080';

export interface AudionState {
  phase: string;
  on: boolean;
  chips: string[];
  problems: string[];
  sentence: string | null;
  caption: string | null;
  speaking: boolean;
  micMuted: boolean;
  inFlight: number;
  notice: string | null;
}

/** One second of 16-bit mono silence: the fake microphone, so any sound on the outgoing track is Audion's. */
function silenceWav(): Buffer {
  const rate = 16000;
  const data = Buffer.alloc(rate * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export const test = base.extend<{ context: BrowserContext; page: Page; requests: Request[] }>({
  context: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'audion-e2e-'));
    const wav = join(dir, 'silence.wav');
    writeFileSync(wav, silenceWav());
    const context = await chromium.launchPersistentContext(join(dir, 'profile'), {
      channel: 'chromium', // new headless: supports extensions
      viewport: { width: 1440, height: 900 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
      args: [
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        '--use-fake-device-for-media-stream', // synthetic camera
        '--use-fake-ui-for-media-stream', // no permission prompt
        `--use-file-for-fake-audio-capture=${wav}`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
    await use(context);
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  },
  requests: async ({ context }, use) => {
    const seen: Request[] = [];
    context.on('request', (r) => seen.push(r));
    await use(seen);
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },
});
export { expect };

export async function extensionId(context: BrowserContext): Promise<string> {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return new URL(sw.url()).host;
}

export const state = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(
        document.documentElement.getAttribute('data-audion-state') ?? 'null',
      ) as AudionState | null,
  );

export async function waitForState(
  page: Page,
  pred: (s: AudionState) => boolean,
  timeout = 20_000,
): Promise<AudionState> {
  const src = pred.toString();
  await page.waitForFunction(
    (code) => {
      const raw = document.documentElement.getAttribute('data-audion-state');
      return raw ? (new Function(`return (${code})`)()(JSON.parse(raw)) as boolean) : false;
    },
    src,
    { timeout },
  );
  return (await state(page))!;
}

/** Feed synthetic landmarks in real time (the recorder runs on the real clock). Frame times are rebased to now. */
export async function playFrames(page: Page, segments: Segment[]) {
  const frames = makeFrames(segments);
  await page.evaluate(async (frames) => {
    const base = performance.now();
    for (const f of frames) {
      await new Promise((r) => setTimeout(r, 1000 / 15));
      window.dispatchEvent(
        new CustomEvent('audion:e2e-frame', { detail: JSON.stringify({ ...f, t: base + f.t }) }),
      );
    }
  }, frames);
}

export const dispatch = (page: Page, event: unknown) =>
  page.evaluate(
    (e) =>
      window.dispatchEvent(new CustomEvent('audion:e2e-dispatch', { detail: JSON.stringify(e) })),
    event,
  );

export const ONE_SIGN: Segment[] = [
  { kind: 'still', ms: 300 },
  { kind: 'move', ms: 1500 },
  { kind: 'still', ms: 700 },
];

/** Hands down for longer than the default sentence pause (Settings > Signing), so Ola composes and speaks. */
export const SENTENCE_PAUSE: Segment = { kind: 'none', ms: DEFAULT_PAUSE_MS + 1100 };

/** Measures the peak level of the audio track Meet (the fake page) sends, using audio-clock callbacks. */
export function installPeakMeter(page: Page) {
  return page.evaluate(async () => {
    const stream = (document.getElementById('selfVideo') as HTMLVideoElement)
      .srcObject as MediaStream;
    const ac = new AudioContext();
    await ac.resume();
    const src = ac.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const sp = ac.createScriptProcessor(2048, 1, 1);
    let peak = 0;
    sp.onaudioprocess = (e) => {
      for (const v of e.inputBuffer.getChannelData(0)) peak = Math.max(peak, Math.abs(v));
    };
    src.connect(sp);
    sp.connect(ac.destination);
    (window as unknown as { __peak: { get(): number; reset(): void } }).__peak = {
      get: () => peak,
      reset: () => (peak = 0),
    };
  });
}
export const peak = (page: Page) =>
  page.evaluate(() => (window as unknown as { __peak: { get(): number } }).__peak.get());
export const resetPeak = (page: Page) =>
  page.evaluate(() => (window as unknown as { __peak: { reset(): void } }).__peak.reset());

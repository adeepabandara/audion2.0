// On-device sentences for the web demo: Gemma 4 E2B running in the visitor's browser (WebGPU, LiteRT-LM).
// It starts loading when the visitor turns Ola on (unless they switched it off, or the connection is a data-saver
// one); Gemini writes sentences until it is ready and whenever it cannot run. The model is a ~2 GB download from
// Hugging Face, kept in the browser's Cache Storage so it is fetched once. The runtime package is loaded only when
// needed, so a visitor who never turns Ola on pays nothing.
import { COMPOSE_CONTEXT_NOTE, COMPOSE_SYSTEM_PROMPT, isGroundedSentence } from '@audion/shared';

export const GEMMA_MODEL_URL =
  import.meta.env.VITE_GEMMA_URL ??
  'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm';
export const GEMMA_SIZE_GB = 2;

export type GemmaStatus =
  | { state: 'off' }
  | { state: 'unsupported'; reason: string }
  | {
      state: 'loading';
      /** 0..1 while downloading, null when not known (or already cached) */ progress:
        | number
        | null;
    }
  | { state: 'ready' }
  | { state: 'failed'; reason: string };

const SHOTS: Array<[string[], string]> = [
  [['hello', 'please', 'wait'], 'Hello, please wait.'],
  [['tomorrow', 'talk', 'finish'], "We'll finish talking tomorrow."],
  [['thankyou', 'bye'], 'Thank you, goodbye.'],
  [['where', 'time'], 'Where is the time?'],
];
const CACHE_NAME = 'ola-gemma-v1';

/**
 * The model as something the runtime can read. Downloaded once into Cache Storage (with progress), then streamed from
 * there on every later visit. Falls back to the plain URL where Cache Storage is unavailable.
 */
export async function modelSource(
  url: string,
  onProgress: (fraction: number | null) => void,
): Promise<string | ReadableStream<Uint8Array>> {
  if (typeof caches === 'undefined') return url;
  try {
    const cache = await caches.open(CACHE_NAME);
    let hit = await cache.match(url);
    if (!hit) {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
      const total = Number(res.headers.get('content-length')) || 0;
      let got = 0;
      const counted = res.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            got += chunk.byteLength;
            onProgress(total ? Math.min(1, got / total) : null);
            controller.enqueue(chunk);
          },
        }),
      );
      // put() resolves once the whole body is stored; a half download is never kept.
      await cache.put(url, new Response(counted, { headers: res.headers }));
      hit = await cache.match(url);
    }
    return hit?.body ?? url;
  } catch (e) {
    if ((e as Error).name === 'QuotaExceededError') return url; // no room to keep it: just stream it this time
    throw e;
  }
}

const glossLine = (signs: string[]) => `Glosses: ${signs.join(', ')}`;

/** What the Gemma runtime needs from the browser; false when it cannot work at all. */
export function gemmaSupport(nav: object = navigator): string | null {
  return 'gpu' in nav && nav.gpu
    ? null
    : 'This browser has no WebGPU, which the on-device model needs.';
}

/** Keep the first line, drop quotes and a leading label, so only the sentence is spoken. */
export function cleanSentence(raw: string): string {
  return (raw.split('\n').find((l) => l.trim()) ?? '')
    .replace(/^(sentence|answer)\s*:\s*/i, '')
    .replace(/^["“']+|["”']+$/g, '')
    .trim();
}

type Conversation = { sendMessage(m: string): Promise<{ content: Array<{ text?: string }> }> };
type Engine = {
  createConversation(o?: unknown): Promise<Conversation>;
  delete(): Promise<void> | void;
};

export interface Gemma {
  status(): GemmaStatus;
  subscribe(cb: (s: GemmaStatus) => void): () => void;
  enable(): Promise<void>;
  disable(): void;
  /** A grounded sentence, or null when Gemma is not ready or its answer is not trustworthy (caller falls back). */
  compose(signs: string[], context?: string): Promise<string | null>;
}

type Runtime = {
  loadLiteRtLm(dir: string): Promise<unknown>;
  Engine: { create(settings: { model: string | ReadableStream<Uint8Array> }): Promise<unknown> };
};

/** `runtime` is injectable for tests; by default the real package is imported on first use. */
export function createGemma(
  wasmDir = '/litert/',
  runtime: () => Promise<Runtime> = () => import('@litert-lm/core') as unknown as Promise<Runtime>,
): Gemma {
  let status: GemmaStatus = { state: 'off' };
  let engine: Engine | undefined;
  let enabling: Promise<void> | undefined;
  const subs = new Set<(s: GemmaStatus) => void>();
  const set = (s: GemmaStatus) => {
    status = s;
    subs.forEach((cb) => cb(s));
  };

  async function load(): Promise<void> {
    const unsupported = gemmaSupport();
    if (unsupported) return set({ state: 'unsupported', reason: unsupported });
    set({ state: 'loading', progress: null });
    try {
      const lm = await runtime();
      await lm.loadLiteRtLm(wasmDir);
      const model = await modelSource(GEMMA_MODEL_URL, (progress) =>
        set({ state: 'loading', progress }),
      );
      engine = (await lm.Engine.create({ model })) as unknown as Engine;
      set({ state: 'ready' });
    } catch (e) {
      engine = undefined;
      set({ state: 'failed', reason: (e as Error).message || 'The model could not be loaded.' });
    }
  }

  return {
    status: () => status,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    enable() {
      if (status.state === 'ready') return Promise.resolve();
      enabling ??= load().finally(() => (enabling = undefined));
      return enabling;
    },
    disable() {
      void engine?.delete();
      engine = undefined;
      set({ state: 'off' });
    },
    async compose(signs, context) {
      if (!engine || status.state !== 'ready') return null;
      try {
        // A fresh conversation per sentence: no memory of earlier ones.
        const convo = await engine.createConversation({ sessionConfig: { maxOutputTokens: 48 } });
        const examples = SHOTS.map(([g, s]) => `${glossLine(g)}\n${s}`).join('\n\n');
        // With a meeting summary, the model may word the sentence for the conversation (the summary is data only).
        const system = context
          ? `${COMPOSE_SYSTEM_PROMPT} ${COMPOSE_CONTEXT_NOTE}`
          : COMPOSE_SYSTEM_PROMPT;
        const reply = await convo.sendMessage(
          `${system}\n\nExamples:\n${examples}\n\n${
            context ? `Meeting context: ${context}\n` : ''
          }${glossLine(signs)}\nSentence:`,
        );
        const sentence = cleanSentence(reply.content.map((c) => c.text ?? '').join(''));
        return sentence && isGroundedSentence(sentence, signs, context) ? sentence : null;
      } catch {
        return null;
      }
    },
  };
}

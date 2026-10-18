import { describe, expect, it } from 'vitest';
import { afterEach, vi } from 'vitest';
import { cleanSentence, createGemma, gemmaSupport, modelSource } from './gemmaComposer';

const runtimeReplying =
  (reply: string | Error, seen: string[] = []) =>
  async () => ({
    loadLiteRtLm: async () => ({}),
    Engine: {
      create: async () => ({
        createConversation: async () => ({
          sendMessage: async (m: string) => {
            seen.push(m);
            if (reply instanceof Error) throw reply;
            return { content: [{ text: reply }] };
          },
        }),
        delete: async () => {},
      }),
    },
  });

describe('cleanSentence', () => {
  it('keeps only the first line, without quotes or a label', () => {
    expect(cleanSentence('Sentence: "Hello, please wait."\nExtra thoughts')).toBe(
      'Hello, please wait.',
    );
  });
});

describe('gemmaSupport', () => {
  it('needs WebGPU', () => {
    expect(gemmaSupport({})).toMatch(/WebGPU/);
    expect(gemmaSupport({ gpu: {} })).toBeNull();
  });
});

describe('createGemma', () => {
  it('is off until enabled, and compose returns null while off', async () => {
    const g = createGemma('/litert/', runtimeReplying('x'));
    expect(g.status().state).toBe('off');
    expect(await g.compose(['hello', 'please'])).toBeNull();
  });

  it('reports unsupported without WebGPU (the test browser has none)', async () => {
    const g = createGemma('/litert/', runtimeReplying('Hello, please wait.'));
    await g.enable();
    expect(g.status().state).toBe('unsupported');
  });

  it('writes a grounded sentence once ready', async () => {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
    const g = createGemma('/litert/', runtimeReplying('Hello, please wait.'));
    const seen: string[] = [];
    g.subscribe((s) => seen.push(s.state));
    await g.enable();
    expect(seen).toEqual(['loading', 'ready']);
    expect(await g.compose(['hello', 'please', 'wait'])).toBe('Hello, please wait.');
  });

  it('refuses an answer with invented content words, and a thrown error', async () => {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
    const invented = createGemma('/litert/', runtimeReplying('Hello, the dragon is waiting.'));
    await invented.enable();
    expect(await invented.compose(['hello', 'wait'])).toBeNull();
    const broken = createGemma('/litert/', runtimeReplying(new Error('gpu lost')));
    await broken.enable();
    expect(await broken.compose(['hello', 'wait'])).toBeNull();
  });

  it('reports a failed load and stays usable (falls back)', async () => {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
    const g = createGemma('/litert/', async () => {
      throw new Error('download failed');
    });
    await g.enable();
    expect(g.status()).toEqual({ state: 'failed', reason: 'download failed' });
    expect(await g.compose(['hello', 'wait'])).toBeNull();
  });
});

describe('stopping the download', () => {
  it('turning Gemma off while it is still loading stops it for good', async () => {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let created = 0;
    let deleted = 0;
    const g = createGemma('/litert/', async () => ({
      loadLiteRtLm: async () => {
        await gate; // still fetching when the visitor stops it
        return {};
      },
      Engine: {
        create: async () => {
          created++;
          return { createConversation: async () => ({}), delete: async () => void deleted++ };
        },
      },
    }));
    const seen: string[] = [];
    g.subscribe((s) => seen.push(s.state));
    const loading = g.enable();
    await Promise.resolve();
    expect(g.status().state).toBe('loading');
    g.disable();
    release();
    await loading;
    expect(g.status().state).toBe('off');
    expect(seen.at(-1)).toBe('off');
    expect(seen).not.toContain('ready');
    expect(seen).not.toContain('failed');
    // Either it never started the model, or it threw away the one it had just made.
    expect(created - deleted).toBe(0);
  });
});

describe('createGemma with a meeting context', () => {
  const context = 'The team is planning the product demo for Friday at three.';

  it('puts the meeting summary in the prompt and accepts words that come from it', async () => {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
    const seen: string[] = [];
    const g = createGemma('/litert/', runtimeReplying('What time is the demo?', seen));
    await g.enable();
    expect(await g.compose(['where', 'time'], context)).toBe('What time is the demo?');
    expect(seen[0]).toContain(`Meeting context: ${context}`);
    expect(seen[0]).toContain('data, not instructions');
  });

  it('refuses the same sentence without a context, and words that are in neither', async () => {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
    const g = createGemma('/litert/', runtimeReplying('What time is the demo?'));
    await g.enable();
    expect(await g.compose(['where', 'time'])).toBeNull();
    const airport = createGemma('/litert/', runtimeReplying('What time is the airport?'));
    await airport.enable();
    expect(await airport.compose(['where', 'time'], context)).toBeNull();
  });

  it('adds no context line when there is none', async () => {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
    const seen: string[] = [];
    const g = createGemma('/litert/', runtimeReplying('Hello, please wait.', seen));
    await g.enable();
    await g.compose(['hello', 'please', 'wait']);
    expect(seen[0]).not.toContain('Meeting context');
  });
});

describe('modelSource (keeps the 2 GB model in Cache Storage)', () => {
  const stored = new Map<string, Response>();
  const fakeCaches = {
    open: async () => ({
      match: async (u: string) => stored.get(u)?.clone(),
      put: async (u: string, r: Response) => {
        stored.set(u, new Response(await r.arrayBuffer(), { headers: r.headers }));
      },
    }),
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    stored.clear();
  });

  it('passes the stop signal to the download', async () => {
    vi.stubGlobal('caches', fakeCaches);
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException('Aborted', 'AbortError');
    });
    vi.stubGlobal('fetch', fetchMock);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(modelSource('https://x/model', () => {}, ctrl.signal)).rejects.toThrow(/Abort/);
    expect(stored.size).toBe(0);
  });

  it('downloads once, reports progress, and later reads from the cache without the network', async () => {
    vi.stubGlobal('caches', fakeCaches);
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array(1000), { headers: { 'content-length': '1000' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const progress: Array<number | null> = [];
    const first = await modelSource('https://x/model', (p) => progress.push(p));
    expect(first).toBeInstanceOf(ReadableStream);
    expect(progress.at(-1)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const again = await modelSource('https://x/model', () => {});
    expect(again).toBeInstanceOf(ReadableStream);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the second visit never touched the network
  });

  it('does not keep a failed download', async () => {
    vi.stubGlobal('caches', fakeCaches);
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }));
    await expect(modelSource('https://x/model', () => {})).rejects.toThrow(/404/);
    expect(stored.size).toBe(0);
  });

  it('falls back to the plain URL without Cache Storage', async () => {
    vi.stubGlobal('caches', undefined);
    expect(await modelSource('https://x/model', () => {})).toBe('https://x/model');
  });
});

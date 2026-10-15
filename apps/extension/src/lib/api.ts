import {
  composeResponseSchema,
  contextResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  recognizeResponseSchema,
  sessionResponseSchema,
  translateResponseSchema,
  type ComposeRequest,
  type ContextRequest,
  type TranslateRequest,
  type SpeakRequest,
} from '@audion/shared';
import type { Failure } from './messages';
import type { KeyValueStore } from './storage';

export interface ApiClientOptions {
  baseUrl: string;
  /** Persistent store for the anonymous install ID. */
  local: KeyValueStore;
  fetchImpl?: typeof fetch;
}

type Result<T> = ({ ok: true } & T) | Failure;

/** Talks to the Audion API with a short-lived token. Used from the service worker only. */
export function createApiClient({
  baseUrl,
  local,
  fetchImpl = (...a) => fetch(...a),
}: ApiClientOptions) {
  let token: { value: string; expiresAt: number } | undefined;

  async function installId(): Promise<string> {
    const existing = await local.get('installId');
    if (typeof existing === 'string') return existing;
    const id = crypto.randomUUID(); // random, carries no personal data
    await local.set('installId', id);
    return id;
  }

  async function ensureToken(force = false): Promise<string> {
    if (!force && token && token.expiresAt - 30_000 > Date.now()) return token.value;
    const res = await fetchImpl(`${baseUrl}/v1/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installId: await installId() }),
    });
    if (!res.ok) throw await failure(res);
    const s = sessionResponseSchema.parse(await res.json());
    token = { value: s.token, expiresAt: Date.now() + s.expiresInSec * 1000 };
    return token.value;
  }

  async function failure(res: Response): Promise<Failure> {
    const parsed = errorResponseSchema.safeParse(await res.json().catch(() => null));
    if (parsed.success) return { ok: false, error: parsed.data.error };
    return {
      ok: false,
      error: {
        code: 'MODEL_UNAVAILABLE',
        message: `Unexpected response (${res.status}).`,
        retryable: res.status >= 500,
      },
    };
  }

  /** Authenticated call; one transparent retry with a fresh token on 401. */
  async function authed(
    path: string,
    init: (token: string) => RequestInit,
  ): Promise<Response | Failure> {
    try {
      for (const force of [false, true]) {
        const res = await fetchImpl(`${baseUrl}${path}`, init(await ensureToken(force)));
        if (res.status !== 401 || force) return res.ok ? res : await failure(res);
      }
    } catch (e) {
      if (isFailure(e)) return e;
      return {
        ok: false,
        error: { code: 'NETWORK', message: (e as Error).message, retryable: true },
      };
    }
    throw new Error('unreachable');
  }

  const isFailure = (x: unknown): x is Failure =>
    typeof x === 'object' && x !== null && 'ok' in x && (x as Failure).ok === false;
  const json = (token: string, body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  return {
    async health(): Promise<
      Result<{
        mode: 'live' | 'mock';
        confidenceThreshold?: number;
        modelId?: string;
        voices?: 'google' | 'mock';
      }>
    > {
      try {
        const res = await fetchImpl(`${baseUrl}/v1/health`);
        if (!res.ok) return await failure(res);
        return { ...healthResponseSchema.parse(await res.json()), ok: true };
      } catch (e) {
        return {
          ok: false,
          error: { code: 'NETWORK', message: (e as Error).message, retryable: true },
        };
      }
    },

    async speak(req: SpeakRequest): Promise<Result<{ audio: ArrayBuffer; contentType: string }>> {
      const res = await authed('/v1/speak', (t) => json(t, req));
      if (isFailure(res)) return res;
      return {
        ok: true,
        audio: await res.arrayBuffer(),
        contentType: res.headers.get('content-type') ?? 'audio/mpeg',
      };
    },

    async recognize(clip: Blob, mime: string, durationMs: number) {
      const res = await authed('/v1/recognize', (t) => {
        const form = new FormData();
        form.append('mime', mime);
        form.append('durationMs', String(Math.round(durationMs)));
        form.append('clip', clip, 'clip');
        return { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: form };
      });
      if (isFailure(res)) return res;
      return { ok: true as const, ...recognizeResponseSchema.parse(await res.json()) };
    },

    async feedback(req: {
      rating: 'up' | 'down';
      signs: string[];
    }): Promise<{ ok: true } | Failure> {
      const res = await authed('/v1/feedback', (t) => json(t, req));
      return isFailure(res) ? res : { ok: true };
    },

    /** Refresh the running meeting summary from new live-caption text. The text is never stored. */
    async context(req: ContextRequest) {
      const res = await authed('/v1/context', (t) => json(t, req));
      if (isFailure(res)) return res;
      return { ok: true as const, ...contextResponseSchema.parse(await res.json()) };
    },

    async translate(req: TranslateRequest) {
      const res = await authed('/v1/translate', (t) => json(t, req));
      if (isFailure(res)) return res;
      return { ok: true as const, ...translateResponseSchema.parse(await res.json()) };
    },

    async compose(req: ComposeRequest) {
      const res = await authed('/v1/compose', (t) => json(t, req));
      if (isFailure(res)) return res;
      return { ok: true as const, ...composeResponseSchema.parse(await res.json()) };
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

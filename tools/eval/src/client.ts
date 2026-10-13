export interface Recognition {
  sign: string;
  confidence: number | null;
  alternatives: Array<{ sign: string; confidence: number }>;
  latencyMs: number;
}

export type Outcome =
  | { ok: true; result: Recognition; wallMs: number }
  | { ok: false; code: string; message: string };

/** Clips go to the API under test and nowhere else. Plain http is allowed only for a local server. */
export function assertSafeApiUrl(url: string): URL {
  const u = new URL(url);
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    throw new Error(
      `Refusing to send clips over ${u.protocol}//${u.hostname}: use https (http only for localhost).`,
    );
  }
  return u;
}

export interface ClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Retries for RATE_LIMITED / retryable model errors. */
  retries?: number;
}

export function createClient({
  baseUrl,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  retries = 3,
}: ClientOptions) {
  const base = assertSafeApiUrl(baseUrl).origin;
  let token: Promise<string> | undefined;

  const getToken = () =>
    (token ??= (async () => {
      const res = await fetchImpl(`${base}/v1/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installId: crypto.randomUUID() }),
      });
      if (!res.ok)
        throw new Error(
          `Could not get a session token (${res.status}). Is the API running at ${base}?`,
        );
      return ((await res.json()) as { token: string }).token;
    })());

  return {
    async recognize(clip: Uint8Array, mime: string): Promise<Outcome> {
      for (let attempt = 0; ; attempt++) {
        const form = new FormData();
        form.append('mime', mime);
        form.append('clip', new Blob([clip], { type: mime }), 'clip');
        const started = performance.now();
        let res: Response;
        try {
          res = await fetchImpl(`${base}/v1/recognize`, {
            method: 'POST',
            headers: { authorization: `Bearer ${await getToken()}` },
            body: form,
          });
        } catch (e) {
          if (attempt < retries) {
            await sleep(500 * 2 ** attempt);
            continue;
          }
          return { ok: false, code: 'NETWORK', message: (e as Error).message };
        }
        if (res.ok) {
          return {
            ok: true,
            result: (await res.json()) as Recognition,
            wallMs: performance.now() - started,
          };
        }
        const err = (
          (await res.json().catch(() => null)) as {
            error?: { code: string; message: string; retryable: boolean };
          } | null
        )?.error;
        if (err?.retryable && attempt < retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        return {
          ok: false,
          code: err?.code ?? `HTTP_${res.status}`,
          message: err?.message ?? res.statusText,
        };
      }
    },
  };
}

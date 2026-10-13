import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSafeApiUrl, createClient, type Outcome } from './client.js';
import { parseLine, parseManifest } from './manifest.js';
import { buildReport, formatReport, percentile, suggestThreshold } from './report.js';
import { pool, type EvalResult } from './run.js';

const run = promisify(execFile);

describe('manifest', () => {
  it('reads the Vertex tuning format, finding the clip by file name (nothing is fetched from gs://)', () => {
    const line = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { fileData: { mimeType: 'video/mp4', fileUri: 'gs://bucket/popsign/clip_001.mp4' } },
            { text: 'The video shows one isolated American Sign Language (ASL) sign.' },
          ],
        },
        { role: 'model', parts: [{ text: 'Thank you' }] },
      ],
    });
    expect(parseLine(line, 1, '/data/clips')).toEqual({
      path: '/data/clips/clip_001.mp4',
      mime: 'video/mp4',
      label: 'thankyou',
      line: 1,
    });
  });

  it('reads the simple format and infers the mime type', () => {
    expect(parseLine('{"clip":"a.webm","label":"Hello."}', 3, '/c')).toMatchObject({
      path: '/c/a.webm',
      mime: 'video/webm',
      label: 'hello',
    });
    expect(parseLine('{"clip":"/abs/x.mov","label":"bye"}', 1, '/c')).toMatchObject({
      path: '/abs/x.mov',
      mime: 'video/quicktime',
    });
  });

  it('skips bad lines with a reason and keeps going', () => {
    const { items, errors } = parseManifest(
      [
        '{"clip":"a.webm","label":"hello"}',
        'not json',
        '{"clip":"b.webm","label":"banana"}',
        '{"label":"yes"}',
        '',
        '{"clip":"c.webm","label":"yes"}',
      ].join('\n'),
      '/c',
    );
    expect(items.map((i) => i.label)).toEqual(['hello', 'yes']);
    expect(errors).toEqual([
      'line 2: not valid JSON',
      'line 3: label "banana" is not in the vocabulary',
      'line 4: no clip reference',
    ]);
  });
});

describe('client', () => {
  it('only sends clips over https, or http to a local server', () => {
    expect(() => assertSafeApiUrl('http://api.example.com')).toThrow(/Refusing/);
    expect(() => assertSafeApiUrl('ftp://localhost')).toThrow(/Refusing/);
    expect(assertSafeApiUrl('http://localhost:8080').origin).toBe('http://localhost:8080');
    expect(assertSafeApiUrl('https://audion.example.run.app/').origin).toBe(
      'https://audion.example.run.app',
    );
  });

  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

  it('gets one token, posts mime + clip, and retries retryable errors with backoff', async () => {
    const seen: Array<{ url: string; fields: string[] }> = [];
    let n = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/session')) return json({ token: 'tok', expiresInSec: 900 });
      const form = init?.body as FormData;
      seen.push({ url: u, fields: [...form.keys()] });
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
      return ++n === 1
        ? json({ error: { code: 'RATE_LIMITED', message: 'slow', retryable: true } }, 429)
        : json({ sign: 'hello', confidence: 0.9, alternatives: [], latencyMs: 12 });
    }) as unknown as typeof fetch;
    const sleeps: number[] = [];
    const c = createClient({
      baseUrl: 'http://localhost:1',
      fetchImpl,
      sleep: async (ms) => void sleeps.push(ms),
    });
    const out = await c.recognize(new Uint8Array([1, 2]), 'video/webm');
    expect(out).toMatchObject({ ok: true, result: { sign: 'hello' } });
    expect(sleeps).toEqual([500]);
    expect(seen.map((s) => s.fields.sort())).toEqual([
      ['clip', 'mime'],
      ['clip', 'mime'],
    ]);
    await c.recognize(new Uint8Array([1]), 'video/webm');
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) =>
        String(u).endsWith('/v1/session'),
      ),
    ).toHaveLength(1);
  });

  it('reports non-retryable errors and gives up after the retries', async () => {
    const bad = createClient({
      baseUrl: 'http://localhost:1',
      sleep: async () => {},
      fetchImpl: (async (url: string | URL | Request) =>
        String(url).endsWith('/v1/session')
          ? json({ token: 't' })
          : json(
              { error: { code: 'CLIP_TOO_LARGE', message: 'big', retryable: false } },
              413,
            )) as typeof fetch,
    });
    expect(await bad.recognize(new Uint8Array(), 'video/webm')).toEqual({
      ok: false,
      code: 'CLIP_TOO_LARGE',
      message: 'big',
    });

    let calls = 0;
    const down = createClient({
      baseUrl: 'http://localhost:1',
      retries: 2,
      sleep: async () => {},
      fetchImpl: (async (url: string | URL | Request) => {
        if (String(url).endsWith('/v1/session')) return json({ token: 't' });
        calls++;
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    expect(await down.recognize(new Uint8Array(), 'video/webm')).toMatchObject({
      ok: false,
      code: 'NETWORK',
    });
    expect(calls).toBe(3);
  });
});

describe('pool', () => {
  it('never exceeds the concurrency limit and keeps input order', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await pool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(peak).toBe(3);
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });
});

describe('report', () => {
  const r = (
    truth: string,
    sign: string,
    confidence: number | null,
    latencyMs = 100,
  ): EvalResult => ({
    item: { path: 'x', mime: 'video/webm', label: truth as never, line: 1 },
    outcome: {
      ok: true,
      result: { sign, confidence, alternatives: [], latencyMs },
      wallMs: latencyMs + 20,
    } as Outcome,
  });
  const err = (truth: string): EvalResult => ({
    item: { path: 'x', mime: 'video/webm', label: truth as never, line: 1 },
    outcome: { ok: false, code: 'NETWORK', message: 'x' },
  });

  const results = [
    r('hello', 'hello', 0.9),
    r('hello', 'hello', 0.8),
    r('hello', 'bye', 0.3),
    r('bye', 'hello', 0.4),
    r('bye', 'hello', 0.2),
    r('bye', 'bye', 0.95),
    r('yes', 'unknown', 0.1),
    err('yes'),
  ];

  it('computes overall, per-sign accuracy, confusions and counts errors separately', () => {
    const rep = buildReport(results);
    expect(rep).toMatchObject({ total: 8, answered: 7, correct: 3 });
    expect(rep.accuracy).toBeCloseTo(3 / 7);
    expect(rep.errors).toEqual([{ code: 'NETWORK', count: 1 }]);
    expect(rep.perSign.find((s) => s.sign === 'hello')).toMatchObject({ n: 3, correct: 2 });
    expect(rep.perSign.find((s) => s.sign === 'bye')).toMatchObject({ n: 3, correct: 1 });
    expect(rep.confusions[0]).toEqual({ truth: 'bye', predicted: 'hello', count: 2 });
    expect(rep.unknownRate).toBeCloseTo(1 / 7);
    expect(rep.vsBaseline).toBeCloseTo(3 / 7 - 0.262);
  });

  it('calibration: mean confidence when right vs wrong, buckets and the threshold sweep', () => {
    const rep = buildReport(results);
    expect(rep.confidence.meanWhenCorrect).toBeCloseTo((0.9 + 0.8 + 0.95) / 3);
    expect(rep.confidence.meanWhenWrong).toBeCloseTo((0.3 + 0.4 + 0.2 + 0.1) / 4);
    const top = rep.confidence.buckets.at(-1)!;
    expect(top).toMatchObject({ n: 3, accuracy: 1 }); // 0.9, 0.8, 0.95
    const at5 = rep.thresholdSweep.find((t) => t.threshold === 0.5)!;
    expect(at5.needConfirm).toBeCloseTo(4 / 7); // 0.3, 0.4, 0.2, 0.1 are below 0.5
    expect(at5.accuracyOfRest).toBe(1);
  });

  it('handles answers with no confidence at all, and says so', () => {
    const rep = buildReport([r('hello', 'hello', null), r('bye', 'hello', null)]);
    expect(rep.confidence).toMatchObject({ reported: 0, missing: 2 });
    expect(formatReport(rep)).toMatch(/API reported none/);
  });

  it('percentiles and the text report', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 50)).toBe(0);
    const text = formatReport(buildReport(results));
    expect(text).toMatch(/Accuracy: 42\.9% \(3\/7\)/);
    expect(text).toMatch(/BELOW baseline|above baseline/);
    expect(text).toMatch(/bye\s+-> hello\s+x2/);
  });
});

describe('CLI against a local API', () => {
  let server: Server | undefined;
  let dir: string | undefined;
  afterEach(async () => {
    server?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('evaluates clips end to end and prints the report', async () => {
    const received: Array<{ mime: string; bytes: number }> = [];
    const answers = ['hello', 'bye', 'hello'];
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      res.setHeader('content-type', 'application/json');
      if (req.url === '/healthz') return void res.end(JSON.stringify({ ok: true, mode: 'live' }));
      if (req.url === '/v1/session')
        return void res.end(JSON.stringify({ token: 't', expiresInSec: 900 }));
      const body = Buffer.concat(chunks).toString('latin1');
      received.push({
        mime: /name="mime"\r\n\r\n([^\r]+)/.exec(body)?.[1] ?? '',
        bytes: body.length,
      });
      res.end(
        JSON.stringify({
          sign: answers[received.length - 1],
          confidence: 0.8,
          alternatives: [],
          latencyMs: 5,
        }),
      );
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    dir = await mkdtemp(join(tmpdir(), 'audion-eval-'));
    for (const f of ['a.webm', 'b.webm', 'c.webm']) await writeFile(join(dir, f), `clip-${f}`);
    await writeFile(
      join(dir, 'test.jsonl'),
      ['hello', 'hello', 'bye']
        .map((l, i) => JSON.stringify({ clip: `${'abc'[i]}.webm`, label: l }))
        .join('\n'),
    );

    const { stdout } = await run('node_modules/.bin/tsx', [
      'src/cli.ts',
      '--manifest',
      join(dir, 'test.jsonl'),
      '--clips',
      dir,
      '--api',
      `http://127.0.0.1:${port}`,
      '--concurrency',
      '1',
      '--json',
      join(dir, 'out.json'),
    ]);
    expect(received).toHaveLength(3);
    expect(received.every((r) => r.mime === 'video/webm')).toBe(true);
    expect(stdout).toMatch(/mode: live/);
    expect(stdout).not.toMatch(/MOCK mode/);
    expect(stdout).toMatch(/Clips: 3/);
    // Sequential answers: hello, bye, hello vs truth hello, hello, bye -> 1/3 right.
    expect(stdout).toMatch(/Accuracy: 33\.3% \(1\/3\)/);
    expect(stdout).toMatch(/hello\s+-> bye/);
  }, 30_000);

  it('refuses to send clips over plain http to a remote host, and explains usage when args are missing', async () => {
    await expect(
      run('node_modules/.bin/tsx', [
        'src/cli.ts',
        '--manifest',
        'm',
        '--clips',
        'c',
        '--api',
        'http://api.example.com',
      ]),
    ).rejects.toMatchObject({ stderr: expect.stringMatching(/Refusing to send clips/) });
    await expect(run('node_modules/.bin/tsx', ['src/cli.ts'])).rejects.toMatchObject({ code: 2 });
  }, 30_000);
});

describe('threshold suggestion', () => {
  const c = (confidence: number, correct: boolean) => ({ confidence, correct });
  // Confident answers are right; unsure ones mostly wrong: a threshold around 0.5 separates them.
  const data = [
    c(0.95, true),
    c(0.9, true),
    c(0.85, true),
    c(0.8, true),
    c(0.7, true),
    c(0.6, true),
    c(0.55, true),
    c(0.4, false),
    c(0.3, false),
    c(0.2, true),
  ];

  it('picks the lowest threshold whose unasked signs meet the accuracy goal within the interruption budget', () => {
    const s = suggestThreshold(data, { minAccuracyOfRest: 0.95, maxConfirmRate: 0.5 });
    // At 0.40 or below the wrong 0.4 answer is among the unasked ones; at 0.45 it is asked about instead.
    expect(s.threshold).toBe(0.45);
    expect(s.accuracyOfRest).toBe(1);
    expect(s.needConfirm).toBeCloseTo(0.3);
  });

  it('returns null when no threshold can meet the goal', () => {
    const noisy = [c(0.9, false), c(0.8, false), c(0.7, true), c(0.6, false)];
    expect(
      suggestThreshold(noisy, { minAccuracyOfRest: 0.95, maxConfirmRate: 0.5 }).threshold,
    ).toBeNull();
    expect(suggestThreshold([]).threshold).toBeNull();
  });

  it('shows up in the text report', () => {
    const results = Array.from({ length: 10 }, (_, i) => ({
      item: { path: 'x', mime: 'video/webm', label: 'hello' as const, line: i },
      outcome: {
        ok: true as const,
        result: { sign: 'hello', confidence: 0.9, alternatives: [], latencyMs: 1 },
        wallMs: 2,
      },
    }));
    expect(formatReport(buildReport(results))).toMatch(/Suggested CONFIDENCE_THRESHOLD=0\.05/);
  });
});

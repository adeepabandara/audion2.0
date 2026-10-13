import { describe, expect, it, vi } from 'vitest';
import type { Failure } from './messages';
import { createRecognitionQueue, type ClipJob } from './recognitionQueue';
import { ClipRecorder, type RecorderFactory } from './recorder';

const job = (): ClipJob => ({ clip: new Blob(['x']), mime: 'video/webm', durationMs: 1000 });
const ok = (sign: string) =>
  ({ ok: true as const, sign, confidence: 0.9, alternatives: [], latencyMs: 1 }) as never;
const fail = (retryable: boolean): Failure => ({
  ok: false,
  error: { code: retryable ? 'NETWORK' : 'BAD_REQUEST', message: 'x', retryable },
});

describe('recognition queue', () => {
  function setup(responses: Array<ReturnType<typeof ok> | Failure>) {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const results: string[] = [];
    const online: boolean[] = [];
    let dropped = 0;
    const recognize = vi.fn(async () => responses.shift()!);
    const q = createRecognitionQueue({
      recognize,
      onResult: (r) => results.push(r.sign),
      onDropped: () => dropped++,
      onOnline: (o) => online.push(o),
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => timers.splice(0),
    });
    const flush = () => new Promise((r) => setTimeout(r, 0));
    return { q, recognize, results, online, timers, flush, dropped: () => dropped };
  }

  it('sends clips in order', async () => {
    const t = setup([ok('hello'), ok('bye')]);
    t.q.enqueue(job());
    t.q.enqueue(job());
    await t.flush();
    expect(t.results).toEqual(['hello', 'bye']);
  });

  it('keeps a clip through network failure, backs off, then delivers it and reports back online', async () => {
    const t = setup([fail(true), fail(true), ok('hello')]);
    t.q.enqueue(job());
    await t.flush();
    expect(t.online).toEqual([false]);
    expect(t.results).toEqual([]);
    expect(t.q.size).toBe(1); // still held, in memory
    expect(t.timers[0]!.ms).toBe(2000);

    t.timers.shift()!.fn();
    await t.flush();
    expect(t.timers[0]!.ms).toBe(4000); // exponential backoff

    t.timers.shift()!.fn();
    await t.flush();
    expect(t.results).toEqual(['hello']);
    expect(t.online).toEqual([false, true]);
    expect(t.q.size).toBe(0);
  });

  it('keeps order: a later clip waits behind one that is being retried', async () => {
    const t = setup([fail(true), ok('hello'), ok('bye')]);
    t.q.enqueue(job());
    t.q.enqueue(job());
    await t.flush();
    expect(t.results).toEqual([]);
    t.timers.shift()!.fn();
    await t.flush();
    expect(t.results).toEqual(['hello', 'bye']);
  });

  it('drops a clip for good on a non-retryable error and carries on', async () => {
    const t = setup([fail(false), ok('bye')]);
    t.q.enqueue(job());
    t.q.enqueue(job());
    await t.flush();
    expect(t.dropped()).toBe(1);
    expect(t.results).toEqual(['bye']);
  });

  it('refuses clips beyond the cap, and stop() discards everything', async () => {
    const t = setup([fail(true)]);
    for (let i = 0; i < 5; i++) expect(t.q.enqueue(job())).toBe(true);
    expect(t.q.enqueue(job())).toBe(false);
    await t.flush();
    t.q.stop();
    expect(t.q.size).toBe(0);
    expect(t.q.enqueue(job())).toBe(false);
  });
});

describe('clip recorder', () => {
  function setup() {
    const events: string[] = [];
    let id = 0;
    const factory: RecorderFactory = () => {
      const n = ++id;
      events.push(`start${n}`);
      return {
        stop: async () => (events.push(`stop${n}`), new Blob(['data'])),
        cancel: () => events.push(`cancel${n}`),
      };
    };
    const timers: Array<() => void> = [];
    let t = 0;
    const rec = new ClipRecorder({} as MediaStream, {
      factory,
      now: () => t,
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => timers.splice(0),
    });
    return { rec, events, timers, advance: (ms: number) => (t += ms) };
  }

  it('records only while armed and restarts while idle so the clip starts just before the sign', () => {
    const { rec, events, timers } = setup();
    rec.arm();
    rec.arm(); // idempotent
    expect(events).toEqual(['start1']);
    timers.shift()!(); // pre-roll window elapsed with no sign
    expect(events).toEqual(['start1', 'cancel1', 'start2']);
  });

  it('stops restarting once a sign starts, then returns the whole clip with its duration', async () => {
    const { rec, events, timers, advance } = setup();
    rec.arm();
    advance(300);
    rec.signStarted();
    expect(timers).toHaveLength(0);
    advance(1500);
    const clip = await rec.finish();
    expect(events).toEqual(['start1', 'stop1']);
    expect(clip).toMatchObject({ mime: 'video/webm', durationMs: 1800 });
    expect(clip!.blob.size).toBeGreaterThan(0);
  });

  it('disarm discards footage; a disarm right after finish is harmless', async () => {
    const a = setup();
    a.rec.arm();
    a.rec.disarm();
    expect(a.events).toEqual(['start1', 'cancel1']);
    expect(await a.rec.finish()).toBeNull();

    const b = setup();
    b.rec.arm();
    b.rec.signStarted();
    const done = b.rec.finish();
    b.rec.disarm();
    expect(await done).not.toBeNull();
    expect(b.events).not.toContain('cancel1');
  });
});

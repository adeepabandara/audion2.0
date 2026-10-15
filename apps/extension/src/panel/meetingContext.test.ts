import { describe, expect, it, vi } from 'vitest';
import type { Request } from '../lib/messages';
import { MeetingContext } from './meetingContext';

/** A scripted clock and timer, a fake caption source and a fake summary service. */
function setup(over: { reply?: (req: Request) => unknown; minChars?: number } = {}) {
  let now = 0;
  let tick: (() => void) | undefined;
  let push: (lines: string[]) => void = () => {};
  const stopped = vi.fn();
  const sent: Array<Extract<Request, { type: 'api/context' }>> = [];
  const ctx = new MeetingContext({
    send: async (req) => {
      sent.push(req as never);
      return over.reply?.(req) ?? { ok: true, summary: `summary ${sent.length}` };
    },
    watch: (cb) => {
      push = cb;
      return stopped;
    },
    intervalMs: 60_000,
    firstMs: 15_000,
    minChars: over.minChars ?? 20,
    now: () => now,
    setInterval: (fn) => ((tick = fn), 1),
    clearInterval: () => (tick = undefined),
  });
  const advance = async (ms: number) => {
    now += ms;
    tick?.();
    await vi.waitFor(() => expect(true).toBe(true));
    await Promise.resolve();
    await Promise.resolve();
  };
  return { ctx, sent, advance, feed: (l: string[]) => push(l), stopped, isTicking: () => !!tick };
}

describe('MeetingContext', () => {
  it('goes from off to waiting to following as captions arrive, and reports each change', () => {
    const { ctx, feed } = setup();
    const states: string[] = [];
    ctx.onChange((u) => states.push(u.state));
    ctx.start();
    feed(['Priya', 'the demo is on Friday at three']);
    expect(states).toEqual(['waiting', 'following']);
  });

  it('ignores captions until it is started', () => {
    const { ctx, feed, sent } = setup();
    feed(['Priya', 'this should not be kept']);
    expect(ctx.summary()).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('makes the first summary after the short delay, then refreshes on the regular interval', async () => {
    const { ctx, sent, advance, feed } = setup();
    ctx.start();
    feed(['Priya: the demo is on Friday at three']);
    await advance(10_000);
    expect(sent).toHaveLength(0); // too early
    await advance(6_000);
    expect(sent).toHaveLength(1);
    expect(ctx.summary()).toBe('summary 1');
    expect(sent[0]!.previous).toBeUndefined();

    feed(['Marcus: I will check the projector tomorrow']);
    await advance(30_000);
    expect(sent).toHaveLength(1); // not yet: the regular interval is a minute
    await advance(31_000);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.previous).toBe('summary 1');
    expect(sent[1]!.transcript).toContain('projector');
    expect(sent[1]!.transcript).not.toContain('demo is on Friday'); // already summarised
  });

  it('removes the overlap between snapshots and lets a growing line replace its earlier self', async () => {
    const { ctx, sent, advance, feed } = setup({ minChars: 10 });
    ctx.start();
    feed(['Priya', 'the demo is']);
    feed(['Priya', 'the demo is on Friday', 'Marcus', 'fine by me']);
    feed(['Marcus', 'fine by me']); // overlap again
    await advance(16_000);
    expect(sent[0]!.transcript.split('\n')).toEqual([
      'Priya',
      'the demo is on Friday',
      'Marcus',
      'fine by me',
    ]);
  });

  it('does not call the cloud when there is hardly anything new to say', async () => {
    const { ctx, sent, advance, feed } = setup({ minChars: 80 });
    ctx.start();
    feed(['ok']);
    await advance(120_000);
    expect(sent).toHaveLength(0);
  });

  it('keeps the captions and retries soon when a summary fails', async () => {
    let calls = 0;
    const { ctx, sent, advance, feed } = setup({
      reply: () => (++calls === 1 ? { ok: false } : { ok: true, summary: 'second try' }),
    });
    ctx.start();
    feed(['Priya: the demo is on Friday at three']);
    await advance(16_000);
    expect(ctx.summary()).toBeNull();
    await advance(5_000);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.transcript).toContain('demo is on Friday'); // the same lines were kept
    expect(ctx.summary()).toBe('second try');
  });

  it('forgets everything on stop and drops a summary that arrives late', async () => {
    let release: (v: unknown) => void = () => {};
    const slow = new Promise((r) => (release = r));
    const { ctx, advance, feed, stopped, isTicking } = setup({ reply: () => slow });
    ctx.start();
    feed(['Priya: the demo is on Friday at three']);
    await advance(16_000);
    ctx.stop();
    release({ ok: true, summary: 'too late' });
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.summary()).toBeNull();
    expect(stopped).toHaveBeenCalled();
    expect(isTicking()).toBe(false);
  });

  it('tells listeners about each refresh (for the pipeline log)', async () => {
    const { ctx, advance, feed } = setup();
    const infos: Array<{ summary: string; chars: number }> = [];
    ctx.onRefreshed((i) => infos.push(i));
    ctx.start();
    feed(['Priya: the demo is on Friday at three']);
    await advance(16_000);
    expect(infos).toMatchObject([{ summary: 'summary 1' }]);
    expect(infos[0]!.chars).toBeGreaterThan(20);
  });
});

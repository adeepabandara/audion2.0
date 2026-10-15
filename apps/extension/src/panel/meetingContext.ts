import { MAX_CONTEXT_CHARS, MAX_TRANSCRIPT_CHARS } from '@audion/shared';
import type { Request } from '../lib/messages';

/**
 * Follows a meeting through its live captions and keeps a short running summary that the sentence step uses to word
 * signs better ("where time" becomes "What time is the demo?" when the meeting is about a demo).
 *
 * Privacy: the captions are other people's words. They live in this object's memory only, are sent to the cloud
 * (to be summarised, never stored or logged there) only while the feature is on and Ola is on, and `stop()` throws
 * everything away.
 */

export type ContextState = 'off' | 'waiting' | 'following';

export interface ContextUpdate {
  state: ContextState;
  summary: string | null;
}

export interface MeetingContextLike {
  start(): void;
  stop(): void;
  /** The current summary, or null when there is none yet. */
  summary(): string | null;
  /** Called on every change of state or summary. */
  onChange(l: (u: ContextUpdate) => void): () => void;
  /** Called after each successful summary refresh (for the pipeline log). */
  onRefreshed?(l: (info: { summary: string; ms: number; chars: number }) => void): () => void;
}

export interface MeetingContextOptions {
  send(req: Request): Promise<unknown>;
  /** Where the captions come from: Meet's caption area in the extension, a scripted feed in the web demo. */
  watch(onSnapshot: (lines: string[]) => void): () => void;
  /** How often the summary is refreshed (only when there is enough new caption text). */
  intervalMs: number;
  /** The first summary comes sooner than the regular refresh. */
  firstMs?: number;
  /** New caption characters needed before a refresh is worth a cloud call. */
  minChars?: number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

const normal = (s: string) => s.replace(/\s+/g, ' ').trim();
/** How many recent lines are remembered for removing the overlap between snapshots. */
const REMEMBER = 40;
const TICK_MS = 4000;

export class MeetingContext implements MeetingContextLike {
  private state: ContextState = 'off';
  private summaryText: string | null = null;
  /** Recent lines, for de-duplicating overlapping snapshots. */
  private recent: string[] = [];
  /** Lines not yet summarised. */
  private pending: string[] = [];
  private stopWatch: (() => void) | null = null;
  private timer: unknown;
  private lastRefreshAt = 0;
  private busy = false;
  private run = 0; // invalidates a summary that arrives after stop()
  private readonly listeners = new Set<(u: ContextUpdate) => void>();
  private readonly refreshed = new Set<
    (i: { summary: string; ms: number; chars: number }) => void
  >();

  constructor(private readonly o: MeetingContextOptions) {}

  summary = (): string | null => this.summaryText;

  onChange = (l: (u: ContextUpdate) => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  onRefreshed = (l: (i: { summary: string; ms: number; chars: number }) => void) => {
    this.refreshed.add(l);
    return () => this.refreshed.delete(l);
  };

  start(): void {
    if (this.state !== 'off') return;
    this.run++;
    this.lastRefreshAt = this.now();
    this.set('waiting');
    this.stopWatch = this.o.watch((lines) => this.feed(lines));
    const every = this.o.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.timer = every(() => void this.tick(), Math.min(TICK_MS, this.o.intervalMs));
  }

  /** Stop following and forget everything: the captions, the pending text and the summary. */
  stop(): void {
    if (this.state === 'off') return;
    this.run++;
    this.stopWatch?.();
    this.stopWatch = null;
    (this.o.clearInterval ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>)))(
      this.timer,
    );
    this.timer = undefined;
    this.recent = [];
    this.pending = [];
    this.summaryText = null;
    this.set('off');
  }

  /**
   * Take a snapshot of the captions on screen. Meet shows the last few lines, so consecutive snapshots overlap:
   * lines already seen are skipped, and a line that has only grown (a speaker still talking) replaces its old self.
   */
  feed(lines: string[]): void {
    if (this.state === 'off') return;
    for (const raw of lines) {
      const line = normal(raw);
      if (!line) continue;
      if (this.recent.includes(line)) continue;
      const grown = this.recent.findIndex((old) => old.length >= 8 && line.startsWith(old));
      if (grown >= 0) {
        const old = this.recent[grown]!;
        this.recent[grown] = line;
        const at = this.pending.lastIndexOf(old);
        if (at >= 0) this.pending[at] = line;
        else this.pending.push(line);
      } else {
        this.recent.push(line);
        this.pending.push(line);
      }
    }
    this.recent = this.recent.slice(-REMEMBER);
    if (this.state === 'waiting' && this.pending.length) this.set('following');
  }

  private async tick(): Promise<void> {
    const due = this.summaryText ? this.o.intervalMs : (this.o.firstMs ?? this.o.intervalMs);
    if (this.now() - this.lastRefreshAt >= due) await this.refresh();
  }

  /** One refresh: summarise the new captions together with the previous summary. */
  async refresh(): Promise<void> {
    if (this.busy || this.state === 'off') return;
    const text = this.pending.join('\n');
    if (text.length < (this.o.minChars ?? 80)) return;
    this.busy = true;
    const run = this.run;
    // Most recent captions first if there are too many; older ones are already in the previous summary.
    const transcript =
      text.length > MAX_TRANSCRIPT_CHARS ? text.slice(-MAX_TRANSCRIPT_CHARS) : text;
    const takenLines = this.pending.length;
    const started = this.now();
    try {
      const res = (await this.o.send({
        type: 'api/context',
        transcript,
        ...(this.summaryText ? { previous: this.summaryText.slice(0, MAX_CONTEXT_CHARS) } : {}),
      })) as { ok: boolean; summary?: string } | undefined;
      if (run !== this.run) return; // stopped meanwhile: drop the result
      if (res?.ok && res.summary) {
        this.pending = this.pending.slice(takenLines); // only what was sent; lines that arrived meanwhile stay
        this.summaryText = res.summary;
        this.lastRefreshAt = this.now();
        this.set('following');
        const info = {
          summary: res.summary,
          ms: Math.round(this.now() - started),
          chars: transcript.length,
        };
        this.refreshed.forEach((l) => l(info));
      } else {
        // Try again at the next tick rather than waiting a whole interval; the lines are kept.
        this.lastRefreshAt = this.now() - (this.o.intervalMs - TICK_MS);
      }
    } finally {
      this.busy = false;
    }
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private set(state: ContextState): void {
    this.state = state;
    const u = { state, summary: this.summaryText };
    this.listeners.forEach((l) => l(u));
  }
}

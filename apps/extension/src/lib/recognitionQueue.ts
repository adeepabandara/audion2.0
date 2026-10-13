import type { Failure, ResponseFor } from './messages';

export interface ClipJob {
  clip: Blob;
  mime: string;
  durationMs: number;
}

type Recognised = Extract<
  ResponseFor<{ type: 'api/recognize'; clipBase64: string; mime: string; durationMs: number }>,
  { ok: true }
>;

export interface QueueOptions {
  recognize(job: ClipJob): Promise<Recognised | Failure>;
  onResult(res: Recognised): void;
  /** A clip was dropped for good (non-retryable error, or the queue was full). */
  onDropped(): void;
  onOnline(online: boolean): void;
  maxQueued?: number;
  baseRetryMs?: number;
  maxRetryMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

/**
 * Sends clips to the API one at a time, in order. Network or rate-limit failures keep the clip (in memory only)
 * and retry with backoff, so signs made while offline are recognised when the connection returns.
 * Clips are never persisted; `stop()` discards them.
 */
export function createRecognitionQueue(opts: QueueOptions) {
  const { maxQueued = 5, baseRetryMs = 2000, maxRetryMs = 15000 } = opts;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const jobs: ClipJob[] = [];
  let running = false;
  let stopped = false;
  let timer: unknown;
  let attempts = 0;
  let offline = false;

  async function pump(): Promise<void> {
    if (running || stopped) return;
    running = true;
    try {
      while (jobs.length && !stopped) {
        const job = jobs[0]!;
        const res = await opts.recognize(job);
        if (stopped) return;
        if (res.ok) {
          jobs.shift();
          attempts = 0;
          if (offline) {
            offline = false;
            opts.onOnline(true);
          }
          opts.onResult(res);
        } else if (res.error.retryable) {
          if (!offline) {
            offline = true;
            opts.onOnline(false);
          }
          const delay = Math.min(baseRetryMs * 2 ** attempts++, maxRetryMs);
          timer = setTimer(() => {
            timer = undefined;
            void pump();
          }, delay);
          return; // keep the job; resume from the timer
        } else {
          jobs.shift();
          attempts = 0;
          opts.onDropped();
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    /** Returns false (and drops the clip) if too many are already waiting. */
    enqueue(job: ClipJob): boolean {
      if (stopped) return false;
      if (jobs.length >= maxQueued) return false;
      jobs.push(job);
      if (timer === undefined) void pump();
      return true;
    },
    get size() {
      return jobs.length;
    },
    stop() {
      stopped = true;
      jobs.length = 0;
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
    },
  };
}

export type RecognitionQueue = ReturnType<typeof createRecognitionQueue>;

import { AppError } from './errors.js';

/** Small in-memory fixed-window limiter. Per-instance only; fine for demo-grade traffic. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {
    this.timer = setInterval(() => this.prune(), windowMs);
    this.timer.unref();
  }

  /** Throws RATE_LIMITED once `key` exceeds `max` hits in the current window. */
  check(key: string, max: number): void {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > max) throw new AppError('RATE_LIMITED', 'Too many requests, slow down.');
  }

  close(): void {
    clearInterval(this.timer);
  }

  private prune(): void {
    const t = this.now();
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}

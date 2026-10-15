import { AppError } from '../errors.js';

export interface DayCount {
  day: string;
  count: number;
}

/** Optional persistence for the count. The server keeps it in memory; dev scripts pass a file-backed store. */
export interface CountStore {
  load(): DayCount | null;
  save(state: DayCount): void;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Cost guard: counts paid model calls per UTC day and refuses once `cap` is reached. In memory by default; a
 * `store` (dev scripts only, see scripts/countStore.ts) lets the count survive restarts. The server code itself
 * never touches the disk (privacy.test.ts enforces that).
 */
export class DailyCallCap {
  private state: DayCount;

  constructor(
    private readonly cap: number,
    private readonly store?: CountStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.state = this.loadToday() ?? { day: utcDay(now()), count: 0 };
  }

  get used(): number {
    this.rollover();
    return this.state.count;
  }

  /** Call before every paid request. Throws DAILY_CAP_REACHED instead of letting the call happen. */
  take(): void {
    this.rollover();
    if (this.state.count >= this.cap) {
      throw new AppError(
        'DAILY_CAP_REACHED',
        `The daily limit of ${this.cap} model calls was reached. It resets at 00:00 UTC.`,
      );
    }
    this.state.count += 1;
    this.save();
  }

  private rollover() {
    const day = utcDay(this.now());
    if (day !== this.state.day) this.state = { day, count: 0 };
  }

  private loadToday(): DayCount | null {
    const saved = this.store?.load();
    return saved && saved.day === utcDay(this.now()) ? saved : null;
  }

  private save() {
    this.store?.save(this.state);
  }
}

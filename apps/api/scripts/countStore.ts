import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { CountStore, DayCount } from '../src/services/callCap.js';

/**
 * Dev scripts only (the server never touches the disk). Keeps the day's paid-call count in a small JSON file,
 * `{ "day": "2026-10-14", "count": 12 }`, so repeated probe/eval runs share one DAILY_CALL_CAP.
 */
export function fileCountStore(path: string): CountStore {
  return {
    load(): DayCount | null {
      if (!existsSync(path)) return null;
      try {
        const v = JSON.parse(readFileSync(path, 'utf8')) as Partial<DayCount>;
        return typeof v.day === 'string' && Number.isInteger(v.count) && v.count! >= 0
          ? { day: v.day, count: v.count! }
          : null;
      } catch {
        return null;
      }
    },
    save(state) {
      writeFileSync(path, JSON.stringify(state));
    },
  };
}

export const DEFAULT_COUNT_FILE = process.env.CALL_CAP_FILE || '.call-cap.json';

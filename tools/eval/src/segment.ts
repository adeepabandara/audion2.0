import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { LandmarkFrame } from '../../../apps/extension/src/lib/landmarks.js';
import {
  DEFAULT_SEGMENTER,
  initialSegmenter,
  stepSegmenter,
  type SegmenterConfig,
  type SegmenterEvent,
} from '../../../apps/extension/src/lib/segmenter.js';

export interface Analysis {
  events: Array<SegmenterEvent & { rel: number }>;
  signs: Array<{ startMs: number; endMs: number; durationMs: number; reason: string }>;
  discards: Array<{ atMs: number; reason: string }>;
  pauses: number;
  /** Smoothed hand speed (hand-sizes/s) over frames where hands were visible. */
  speed: { p10: number; p50: number; p90: number; max: number };
}

const pctile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! : 0;

/** Run a landmark recording through the segmenter with the given thresholds. */
export function analyse(
  frames: LandmarkFrame[],
  cfg: SegmenterConfig = DEFAULT_SEGMENTER,
): Analysis {
  const t0 = frames[0]?.t ?? 0;
  let state = initialSegmenter();
  const events: Analysis['events'] = [];
  const speeds: number[] = [];
  for (const f of frames) {
    const [next, ev] = stepSegmenter(state, f, cfg);
    state = next;
    if (f.hands.length) speeds.push(state.speed);
    for (const e of ev) events.push({ ...e, rel: e.t - t0 });
  }
  speeds.sort((a, b) => a - b);
  return {
    events,
    signs: events.flatMap((e) =>
      e.type === 'signEnd'
        ? [
            {
              startMs: e.startT - t0,
              endMs: e.endT - t0,
              durationMs: e.endT - e.startT,
              reason: e.reason,
            },
          ]
        : [],
    ),
    discards: events.flatMap((e) =>
      e.type === 'signDiscarded' ? [{ atMs: e.rel, reason: e.reason }] : [],
    ),
    pauses: events.filter((e) => e.type === 'pause').length,
    speed: {
      p10: pctile(speeds, 10),
      p50: pctile(speeds, 50),
      p90: pctile(speeds, 90),
      max: speeds.at(-1) ?? 0,
    },
  };
}

export function formatAnalysis(a: Analysis, cfg: SegmenterConfig): string {
  const L: string[] = [];
  L.push(
    `Thresholds: start ${cfg.startSpeed}, rest ${cfg.restSpeed}, hold ${cfg.holdMs} ms, min ${cfg.minMs} ms, max ${cfg.maxMs} ms, pause ${cfg.pauseMs} ms`,
  );
  L.push(
    `Speed while hands visible (hand-sizes/s): p10 ${a.speed.p10.toFixed(2)}  p50 ${a.speed.p50.toFixed(2)}  p90 ${a.speed.p90.toFixed(2)}  max ${a.speed.max.toFixed(2)}`,
  );
  L.push('');
  L.push(`${a.signs.length} sign(s), ${a.discards.length} discarded, ${a.pauses} pause(s)`);
  for (const [i, s] of a.signs.entries())
    L.push(
      `  sign ${i + 1}: ${(s.startMs / 1000).toFixed(2)}s - ${(s.endMs / 1000).toFixed(2)}s  (${(s.durationMs / 1000).toFixed(2)}s, ended by ${s.reason})`,
    );
  for (const d of a.discards)
    L.push(
      `  discarded at ${(d.atMs / 1000).toFixed(2)}s: ${d.reason === 'tooShort' ? 'too short (try raising nothing: sign was brief)' : 'too long'}`,
    );
  L.push('');
  L.push('Tuning hints:');
  L.push(
    '  - Signs that never start: lower --start-speed (it should sit well below your usual sign speed, above the resting p50).',
  );
  L.push('  - One sign split in two: lower --rest-speed or raise --hold-ms.');
  L.push('  - Two signs merged: raise --rest-speed or lower --hold-ms.');
  L.push(
    '  - Many "too short": lower --min-ms; many "too long": raise --max-ms (the API accepts clips up to 5 s in total).',
  );
  return L.join('\n');
}

async function main() {
  const args = process.argv.slice(2).filter((a, i) => !(a === '--' && i === 0));
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'start-speed': { type: 'string' },
      'rest-speed': { type: 'string' },
      'hold-ms': { type: 'string' },
      'min-ms': { type: 'string' },
      'max-ms': { type: 'string' },
      'pause-ms': { type: 'string' },
    },
  });
  const file = positionals[0];
  if (!file) {
    console.log(
      'Usage: pnpm --filter @audion/eval segment recording.landmarks.json [--start-speed N --rest-speed N --hold-ms N --min-ms N --max-ms N --pause-ms N]',
    );
    process.exit(2);
  }
  const rec = JSON.parse(await readFile(file, 'utf8')) as { frames: LandmarkFrame[] };
  const num = (k: string, d: number) =>
    values[k as keyof typeof values] ? Number(values[k as keyof typeof values]) : d;
  const cfg: SegmenterConfig = {
    ...DEFAULT_SEGMENTER,
    startSpeed: num('start-speed', DEFAULT_SEGMENTER.startSpeed),
    restSpeed: num('rest-speed', DEFAULT_SEGMENTER.restSpeed),
    holdMs: num('hold-ms', DEFAULT_SEGMENTER.holdMs),
    minMs: num('min-ms', DEFAULT_SEGMENTER.minMs),
    maxMs: num('max-ms', DEFAULT_SEGMENTER.maxMs),
    pauseMs: num('pause-ms', DEFAULT_SEGMENTER.pauseMs),
  };
  console.log(formatAnalysis(analyse(rec.frames, cfg), cfg));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: Error) => {
    console.error(`segment failed: ${e.message}`);
    process.exit(1);
  });
}

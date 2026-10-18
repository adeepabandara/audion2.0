import { frameMotion, type LandmarkFrame } from './landmarks';

export interface SegmenterConfig {
  /** Speed (hand-sizes/s) above which a hand counts as signing. */
  startSpeed: number;
  /** Speed below which a hand counts as resting. Lower than startSpeed so brief slowdowns inside a sign don't end it. */
  restSpeed: number;
  /** Rest this long to end a sign (setting: holdTimeMs). */
  holdMs: number;
  minMs: number;
  maxMs: number;
  /** No hands this long after a sign means the signer has finished their sentence. */
  pauseMs: number;
  /** Tolerate tracker dropouts shorter than this before treating the hands as gone. */
  lostMs: number;
}

export const DEFAULT_SEGMENTER: SegmenterConfig = {
  startSpeed: 0.9,
  restSpeed: 0.4,
  holdMs: 400,
  minMs: 600,
  maxMs: 6000,
  pauseMs: 1500,
  lostMs: 250,
};

export type Phase = 'idle' | 'seeing' | 'signing' | 'holding';

export interface SegmenterState {
  phase: Phase;
  prev: LandmarkFrame | null;
  /** Exponentially smoothed speed. */
  speed: number;
  lastSeenT: number | null;
  signStartT: number | null;
  restSinceT: number | null;
  /** After a too-long discard, wait for the hands to rest before accepting a new sign. */
  needRest: boolean;
  /** A sign finished since the last pause event. */
  pausePending: boolean;
  /** When the last accepted sign ended. A pause is measured from here, whether or not the hands are in view. */
  lastSignEndT: number | null;
}

export type DiscardReason = 'tooShort' | 'tooLong';

export type SegmenterEvent =
  | { type: 'handsAppeared'; t: number }
  | { type: 'handsLeft'; t: number }
  | { type: 'signStart'; t: number }
  | { type: 'signEnd'; t: number; startT: number; endT: number; reason: 'hold' | 'handsLeft' }
  | { type: 'signDiscarded'; t: number; reason: DiscardReason }
  | { type: 'pause'; t: number };

export const initialSegmenter = (): SegmenterState => ({
  phase: 'idle',
  prev: null,
  speed: 0,
  lastSeenT: null,
  signStartT: null,
  restSinceT: null,
  needRest: false,
  pausePending: false,
  lastSignEndT: null,
});

const ALPHA = 0.5;

/** Pure step: previous state + one landmark frame in, next state + events out. */
export function stepSegmenter(
  state: SegmenterState,
  frame: LandmarkFrame,
  cfg: SegmenterConfig = DEFAULT_SEGMENTER,
): [SegmenterState, SegmenterEvent[]] {
  const events: SegmenterEvent[] = [];
  const s: SegmenterState = { ...state };
  const t = frame.t;
  const visible = frame.hands.length > 0;

  if (visible) {
    s.speed = ALPHA * frameMotion(state.prev, frame) + (1 - ALPHA) * state.speed;
    s.lastSeenT = t;
    s.prev = frame;
    if (s.phase === 'idle') {
      s.phase = 'seeing';
      events.push({ type: 'handsAppeared', t });
    }
  } else if (s.lastSeenT !== null && t - s.lastSeenT < cfg.lostMs) {
    // Brief dropout: carry on as if the hands were still, so one missed detection can't split a sign.
    s.speed = (1 - ALPHA) * s.speed;
  } else if (s.phase !== 'idle') {
    // Hands are gone.
    const endT = s.lastSeenT ?? t;
    if (s.phase === 'signing' || s.phase === 'holding') {
      finish(
        s,
        events,
        t,
        s.signStartT ?? endT,
        s.phase === 'holding' ? (s.restSinceT ?? endT) : endT,
        'handsLeft',
        cfg,
      );
    }
    s.phase = 'idle';
    s.prev = null;
    s.speed = 0;
    s.signStartT = s.restSinceT = null;
    s.needRest = false;
    events.push({ type: 'handsLeft', t: endT });
  }

  if (!visible) return [pauseIfIdle(s, t, cfg, events), events];

  switch (s.phase) {
    case 'seeing':
      if (s.needRest && s.speed < cfg.restSpeed) s.needRest = false;
      if (!s.needRest && s.speed > cfg.startSpeed) {
        s.phase = 'signing';
        s.signStartT = t;
        events.push({ type: 'signStart', t });
      }
      break;
    case 'signing':
      if (t - (s.signStartT ?? t) > cfg.maxMs) {
        events.push({ type: 'signDiscarded', t, reason: 'tooLong' });
        s.phase = 'seeing';
        s.signStartT = null;
        s.needRest = true;
      } else if (s.speed < cfg.restSpeed) {
        s.phase = 'holding';
        s.restSinceT = t;
      }
      break;
    case 'holding':
      if (s.speed >= cfg.restSpeed) {
        s.phase = 'signing';
        s.restSinceT = null;
      } else if (t - (s.restSinceT ?? t) >= cfg.holdMs) {
        finish(s, events, t, s.signStartT ?? t, s.restSinceT ?? t, 'hold', cfg);
        s.phase = 'seeing';
      }
      break;
  }
  return [pauseIfIdle(s, t, cfg, events), events];
}

/**
 * The signer has finished a sentence when no new sign has started for `pauseMs` after the last one ended. Hands
 * leaving the picture is not required: people often leave them resting in view, and then nothing would ever be
 * spoken automatically.
 */
function pauseIfIdle(
  s: SegmenterState,
  t: number,
  cfg: SegmenterConfig,
  events: SegmenterEvent[],
): SegmenterState {
  if (
    s.pausePending &&
    s.lastSignEndT !== null &&
    s.phase !== 'signing' &&
    s.phase !== 'holding' &&
    t - s.lastSignEndT >= cfg.pauseMs
  ) {
    s.pausePending = false;
    events.push({ type: 'pause', t });
  }
  return s;
}

function finish(
  s: SegmenterState,
  events: SegmenterEvent[],
  t: number,
  startT: number,
  endT: number,
  reason: 'hold' | 'handsLeft',
  cfg: SegmenterConfig,
) {
  const dur = endT - startT;
  s.signStartT = null;
  s.restSinceT = null;
  if (dur < cfg.minMs) events.push({ type: 'signDiscarded', t, reason: 'tooShort' });
  else if (dur > cfg.maxMs) events.push({ type: 'signDiscarded', t, reason: 'tooLong' });
  else {
    events.push({ type: 'signEnd', t, startT, endT, reason });
    s.pausePending = true;
    s.lastSignEndT = t;
  }
}

/** Convenience for tests and offline analysis: run a whole recording through the segmenter. */
export function runSegmenter(
  frames: LandmarkFrame[],
  cfg: SegmenterConfig = DEFAULT_SEGMENTER,
): SegmenterEvent[] {
  let state = initialSegmenter();
  const all: SegmenterEvent[] = [];
  for (const f of frames) {
    const [next, ev] = stepSegmenter(state, f, cfg);
    state = next;
    all.push(...ev);
  }
  return all;
}

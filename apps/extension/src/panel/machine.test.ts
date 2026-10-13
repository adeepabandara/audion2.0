import { describe, expect, it } from 'vitest';
import {
  ALL_PHASES,
  ALL_PROBLEMS,
  PHASE_VIEW,
  PROBLEM_VIEW,
  initialMachine,
  pendingChip,
  phaseOf,
  reduce,
  viewOf,
  type MachineEvent,
  type MachineState,
} from './machine';
import { STATUS_META } from '@audion/ui';

const run = (events: MachineEvent[], from: MachineState = initialMachine()) =>
  events.reduce(reduce, from);
const on = (): MachineEvent[] => [{ type: 'TURN_ON' }, { type: 'CAMERA_READY' }];
const recognised = (sign: 'hello' | 'tomorrow', confidence: number | null): MachineEvent => ({
  type: 'RECOGNISED',
  sign,
  confidence,
  threshold: 0.5,
});

describe('panel state machine: main path', () => {
  it('walks off -> starting -> ready -> seeing -> signing -> recognising -> chips', () => {
    let s = initialMachine();
    const seen: string[] = [phaseOf(s)];
    for (const e of [
      { type: 'TURN_ON' },
      { type: 'CAMERA_READY' },
      { type: 'HANDS_APPEARED' },
      { type: 'SIGN_STARTED' },
      { type: 'CLIP_READY' },
      recognised('hello', 0.9),
      { type: 'HANDS_LEFT' },
    ] as MachineEvent[]) {
      s = reduce(s, e);
      seen.push(phaseOf(s));
    }
    expect(seen).toEqual([
      'off',
      'starting',
      'ready',
      'seeing',
      'signing',
      'recognising',
      'seeing',
      'chips',
    ]);
    expect(s.chips).toMatchObject([{ sign: 'hello', state: 'normal' }]);
  });

  it('continues through composing, sentence and speaking back to ready', () => {
    let s = run([...on(), { type: 'CLIP_READY' }, recognised('hello', 0.9)]);
    s = reduce(s, { type: 'COMPOSE_START' });
    expect(phaseOf(s)).toBe('composing');
    s = reduce(s, { type: 'COMPOSED', sentence: 'Hello.' });
    expect(phaseOf(s)).toBe('sentence');
    s = reduce(s, { type: 'SPEAK_START' });
    expect(phaseOf(s)).toBe('speaking');
    s = reduce(s, { type: 'SPOKEN' });
    expect(phaseOf(s)).toBe('ready');
    expect(s.chips).toEqual([]);
  });

  it('cannot compose or speak with nothing to say', () => {
    const s = run(on());
    expect(reduce(s, { type: 'COMPOSE_START' }).composing).toBe(false);
    expect(reduce(s, { type: 'SPEAK_START' }).speaking).toBe(false);
  });

  it('turning off resets everything; hands are ignored until the camera is ready', () => {
    const early = run([{ type: 'TURN_ON' }, { type: 'HANDS_APPEARED' }]);
    expect(early.handsVisible).toBe(false);
    const off = run([
      ...on(),
      { type: 'CLIP_READY' },
      recognised('hello', 0.9),
      { type: 'TURN_OFF' },
    ]);
    expect(off).toEqual(initialMachine());
  });

  it('keeps recognising while several clips are in flight', () => {
    let s = run([...on(), { type: 'CLIP_READY' }, { type: 'CLIP_READY' }]);
    expect(s.inFlight).toBe(2);
    s = reduce(s, recognised('hello', 0.9));
    expect(phaseOf(s)).toBe('recognising');
    s = reduce(s, recognised('tomorrow', 0.9));
    expect(phaseOf(s)).toBe('chips');
  });
});

describe('low confidence confirmation', () => {
  it('marks a chip low-confidence below the threshold, but not null or exactly at it', () => {
    const low = run([...on(), { type: 'CLIP_READY' }, recognised('tomorrow', 0.35)]);
    expect(pendingChip(low)?.sign).toBe('tomorrow');
    const none = run([...on(), { type: 'CLIP_READY' }, recognised('tomorrow', null)]);
    expect(pendingChip(none)).toBeUndefined(); // no logprobs: everything counts as confirmed, never invent a number
    const edge = run([...on(), { type: 'CLIP_READY' }, recognised('tomorrow', 0.5)]);
    expect(pendingChip(edge)).toBeUndefined();
  });

  it('Yes confirms the chip; Try again removes it', () => {
    const base = run([
      ...on(),
      { type: 'CLIP_READY' },
      recognised('hello', 0.9),
      { type: 'CLIP_READY' },
      recognised('tomorrow', 0.3),
    ]);
    expect(run([{ type: 'CONFIRM_YES' }], base).chips.map((c) => c.state)).toEqual([
      'normal',
      'confirmed',
    ]);
    expect(run([{ type: 'CONFIRM_RETRY' }], base).chips.map((c) => c.sign)).toEqual(['hello']);
  });
});

describe('orthogonal problems', () => {
  it('lowLight and handsOut toggle without changing the phase', () => {
    const s = run([
      ...on(),
      { type: 'HANDS_APPEARED' },
      { type: 'LIGHT', dark: true },
      { type: 'HANDS_EDGE', out: true },
    ]);
    expect(s.problems).toEqual(['lowLight', 'handsOut']);
    expect(phaseOf(s)).toBe('seeing');
    expect(run([{ type: 'LIGHT', dark: false }, { type: 'HANDS_LEFT' }], s).problems).toEqual([]);
  });

  it('notRecognised comes from unknown signs and discarded clips, and clears on the next sign', () => {
    let s = run([
      ...on(),
      { type: 'CLIP_READY' },
      { type: 'RECOGNISED', sign: 'unknown', confidence: 0.2, threshold: 0.5 },
    ]);
    expect(s.problems).toContain('notRecognised');
    expect(s.chips).toEqual([]);
    s = reduce(s, { type: 'SIGN_STARTED' });
    expect(s.problems).not.toContain('notRecognised');
    s = reduce(s, { type: 'CLIP_DISCARDED', reason: 'tooShort' });
    expect(s.problems).toContain('notRecognised');
  });

  it('offline follows retryable failures and clears when a recognition succeeds', () => {
    let s = run([...on(), { type: 'CLIP_READY' }, { type: 'RECOGNISE_FAILED', retryable: true }]);
    expect(s.problems).toContain('offline');
    s = run([{ type: 'CLIP_READY' }, recognised('hello', 0.9)], s);
    expect(s.problems).not.toContain('offline');
    expect(run([{ type: 'RECOGNISE_FAILED', retryable: false }], s).problems).toContain(
      'notRecognised',
    );
  });

  it('camera failure returns to off with cameraBlocked and keeps the reason', () => {
    const s = run([{ type: 'TURN_ON' }, { type: 'CAMERA_FAILED', problem: 'busy' }]);
    expect(phaseOf(s)).toBe('off');
    expect(s.problems).toEqual(['cameraBlocked']);
    expect(s.cameraProblem).toBe('busy');
    expect(viewOf(s).label).toBe('Camera blocked');
  });

  it('Cancel (CLEAR) drops chips and any sentence', () => {
    const s = run([
      ...on(),
      { type: 'CLIP_READY' },
      recognised('hello', 0.9),
      { type: 'COMPOSE_START' },
      { type: 'COMPOSED', sentence: 'Hello.' },
      { type: 'CLEAR' },
    ]);
    expect(s.chips).toEqual([]);
    expect(s.sentence).toBeNull();
    expect(phaseOf(s)).toBe('ready');
  });
});

describe('every state has an icon, a label and a live announcement', () => {
  it('maps all phases and problems to a known status with text', () => {
    for (const p of ALL_PHASES) {
      const v = PHASE_VIEW[p];
      expect(STATUS_META[v.status], p).toBeDefined();
      expect(v.label.length, p).toBeGreaterThan(0);
    }
    for (const p of ALL_PROBLEMS) {
      const v = PROBLEM_VIEW.find(([k]) => k === p)?.[1];
      expect(v, p).toBeDefined();
      expect(STATUS_META[v!.status], p).toBeDefined();
      expect(v!.label.length).toBeGreaterThan(0);
      expect(v!.hint.length).toBeGreaterThan(0);
    }
  });

  it('shows the most important problem first', () => {
    const s: MachineState = { ...run(on()), problems: ['lowLight', 'offline', 'notRecognised'] };
    expect(viewOf(s).problem).toBe('offline');
    expect(viewOf({ ...s, problems: ['handsOut', 'lowLight'] }).problem).toBe('lowLight');
  });
});

describe('composing, speaking and captions', () => {
  const withChips = (...signs: Array<'hello' | 'tomorrow'>) =>
    run([
      ...on(),
      ...signs.flatMap((sign) => [{ type: 'CLIP_READY' } as const, recognised(sign, 0.9)]),
    ]);

  it('only the signs that made the sentence are cleared once it is spoken', () => {
    let s = withChips('hello');
    s = reduce(s, { type: 'COMPOSE_START' });
    // A new sign arrives while the sentence is still being written and spoken.
    s = run([{ type: 'CLIP_READY' }, recognised('tomorrow', 0.9)], s);
    s = run(
      [{ type: 'COMPOSED', sentence: 'Hello.' }, { type: 'SPEAK_START' }, { type: 'SPOKEN' }],
      s,
    );
    expect(s.chips.map((c) => c.sign)).toEqual(['tomorrow']);
    expect(s.sentence).toBeNull();
  });

  it('shows the caption from the start of speech until it is cleared', () => {
    let s = run(
      [{ type: 'COMPOSE_START' }, { type: 'COMPOSED', sentence: 'Hello.' }],
      withChips('hello'),
    );
    expect(s.caption).toBeNull();
    s = reduce(s, { type: 'SPEAK_START' });
    expect(s.caption).toBe('Hello.');
    s = reduce(s, { type: 'SPOKEN' });
    expect(s.caption).toBe('Hello.'); // lingers for a few seconds
    expect(reduce(s, { type: 'CAPTION_CLEAR' }).caption).toBeNull();
  });

  it('keeps the sentence when speaking fails so the signer can retry, and says why', () => {
    const base = run(
      [
        { type: 'COMPOSE_START' },
        { type: 'COMPOSED', sentence: 'Hello.' },
        { type: 'SPEAK_START' },
      ],
      withChips('hello'),
    );
    const noVoice = reduce(base, { type: 'SPEAK_FAILED', reason: 'noChannel' });
    expect(noVoice.sentence).toBe('Hello.');
    expect(noVoice.speaking).toBe(false);
    expect(viewOf(noVoice)).toMatchObject({
      label: 'Voice not connected',
      problem: 'voiceUnavailable',
    });
    expect(viewOf(noVoice).hint).toMatch(/Reload this Meet tab/);
    expect(reduce(base, { type: 'SPEAK_FAILED', reason: 'network' }).problems).toContain('offline');
    // Trying again clears the voice problem.
    expect(reduce(noVoice, { type: 'SPEAK_START' }).problems).not.toContain('voiceUnavailable');
  });

  it('tracks Meet’s mute state and notices, and Cancel drops the sentence and its signs', () => {
    expect(reduce(initialMachine(), { type: 'MIC_MUTED', muted: true }).micMuted).toBe(true);
    expect(reduce(initialMachine(), { type: 'NOTICE', text: 'x' }).notice).toBe('x');
    const s = run(
      [{ type: 'COMPOSE_START' }, { type: 'COMPOSED', sentence: 'Hello.' }, { type: 'CLEAR' }],
      withChips('hello'),
    );
    expect(s).toMatchObject({ sentence: null, chips: [], sentenceIds: [] });
  });

  it('a failed compose returns to chips and flags the problem', () => {
    const s = run(
      [{ type: 'COMPOSE_START' }, { type: 'COMPOSE_FAILED', retryable: true }],
      withChips('hello'),
    );
    expect(phaseOf(s)).toBe('chips');
    expect(s.chips).toHaveLength(1);
    expect(s.problems).toContain('offline');
  });
});

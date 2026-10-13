import type { Sign } from '@audion/shared';
import type { Status } from '@audion/ui';
import type { CameraProblem } from '../lib/camera';

/** Orthogonal conditions that can overlay any phase. */
export type Problem =
  | 'lowLight'
  | 'handsOut'
  | 'notRecognised'
  | 'offline'
  | 'cameraBlocked'
  | 'voiceUnavailable';

export type Phase =
  | 'off'
  | 'starting'
  | 'ready'
  | 'seeing'
  | 'signing'
  | 'recognising'
  | 'chips'
  | 'composing'
  | 'sentence'
  | 'speaking';

export interface ChipItem {
  id: number;
  sign: Sign;
  state: 'normal' | 'lowConfidence' | 'confirmed';
  confidence: number | null;
}

export interface MachineState {
  on: boolean;
  starting: boolean;
  handsVisible: boolean;
  signing: boolean;
  /** Clips sent (or queued) and not yet answered. */
  inFlight: number;
  composing: boolean;
  speaking: boolean;
  sentence: string | null;
  /** Chips included in the sentence being composed / spoken; only these are removed once it is spoken. */
  composingIds: number[];
  sentenceIds: number[];
  /** Text for the on-screen caption bar (set when speaking starts, cleared a few seconds after). */
  caption: string | null;
  /** Meet's own mute switch is on, so nobody can hear Audion. */
  micMuted: boolean;
  /** Short, non-blocking message (e.g. chat post skipped). */
  notice: string | null;
  chips: ChipItem[];
  problems: Problem[];
  cameraProblem: CameraProblem | null;
  nextId: number;
}

export const initialMachine = (): MachineState => ({
  on: false,
  starting: false,
  handsVisible: false,
  signing: false,
  inFlight: 0,
  composing: false,
  speaking: false,
  sentence: null,
  composingIds: [],
  sentenceIds: [],
  caption: null,
  micMuted: false,
  notice: null,
  chips: [],
  problems: [],
  cameraProblem: null,
  nextId: 1,
});

export type MachineEvent =
  | { type: 'TURN_ON' }
  | { type: 'CAMERA_READY' }
  | { type: 'CAMERA_FAILED'; problem: CameraProblem }
  | { type: 'TURN_OFF' }
  | { type: 'HANDS_APPEARED' }
  | { type: 'HANDS_LEFT' }
  | { type: 'SIGN_STARTED' }
  | { type: 'CLIP_READY' }
  | { type: 'CLIP_DISCARDED'; reason: 'tooShort' | 'tooLong' }
  | { type: 'RECOGNISED'; sign: Sign | 'unknown'; confidence: number | null; threshold: number }
  | { type: 'RECOGNISE_FAILED'; retryable: boolean }
  | { type: 'CONFIRM_YES' }
  | { type: 'CONFIRM_RETRY' }
  | { type: 'CLEAR' }
  | { type: 'COMPOSE_START' }
  | { type: 'COMPOSED'; sentence: string }
  | { type: 'COMPOSE_FAILED'; retryable: boolean }
  | { type: 'SPEAK_START' }
  | { type: 'SPOKEN' }
  | { type: 'SPEAK_FAILED'; reason: 'noChannel' | 'network' | 'other' }
  | { type: 'CAPTION_CLEAR' }
  | { type: 'MIC_MUTED'; muted: boolean }
  | { type: 'NOTICE'; text: string | null }
  | { type: 'LIGHT'; dark: boolean }
  | { type: 'HANDS_EDGE'; out: boolean }
  | { type: 'ONLINE'; online: boolean }
  | { type: 'DISMISS'; problem: Problem };

const withProblem = (list: Problem[], p: Problem) => (list.includes(p) ? list : [...list, p]);
const withoutProblem = (list: Problem[], p: Problem) => list.filter((x) => x !== p);

/** The first chip waiting for the signer's yes/try-again. */
export const pendingChip = (s: MachineState): ChipItem | undefined =>
  s.chips.find((c) => c.state === 'lowConfidence');

export function reduce(s: MachineState, e: MachineEvent): MachineState {
  switch (e.type) {
    case 'TURN_ON':
      return { ...initialMachine(), on: true, starting: true };
    case 'CAMERA_READY':
      return s.on
        ? {
            ...s,
            starting: false,
            cameraProblem: null,
            problems: withoutProblem(s.problems, 'cameraBlocked'),
          }
        : s;
    case 'CAMERA_FAILED':
      return { ...initialMachine(), problems: ['cameraBlocked'], cameraProblem: e.problem };
    case 'TURN_OFF':
      return initialMachine();
    case 'HANDS_APPEARED':
      return s.on && !s.starting ? { ...s, handsVisible: true } : s;
    case 'HANDS_LEFT':
      return {
        ...s,
        handsVisible: false,
        signing: false,
        problems: withoutProblem(s.problems, 'handsOut'),
      };
    case 'SIGN_STARTED':
      return { ...s, signing: true, problems: withoutProblem(s.problems, 'notRecognised') };
    case 'CLIP_READY':
      return { ...s, signing: false, inFlight: s.inFlight + 1 };
    case 'CLIP_DISCARDED':
      return { ...s, signing: false, problems: withProblem(s.problems, 'notRecognised') };
    case 'RECOGNISED': {
      const inFlight = Math.max(0, s.inFlight - 1);
      if (e.sign === 'unknown') {
        return {
          ...s,
          inFlight,
          problems: withProblem(withoutProblem(s.problems, 'offline'), 'notRecognised'),
        };
      }
      const low = e.confidence !== null && e.confidence < e.threshold;
      const chip: ChipItem = {
        id: s.nextId,
        sign: e.sign,
        state: low ? 'lowConfidence' : 'normal',
        confidence: e.confidence,
      };
      return {
        ...s,
        inFlight,
        chips: [...s.chips, chip],
        nextId: s.nextId + 1,
        problems: withoutProblem(withoutProblem(s.problems, 'offline'), 'notRecognised'),
      };
    }
    case 'RECOGNISE_FAILED':
      return {
        ...s,
        inFlight: Math.max(0, s.inFlight - 1),
        problems: withProblem(s.problems, e.retryable ? 'offline' : 'notRecognised'),
      };
    case 'CONFIRM_YES': {
      const p = pendingChip(s);
      return p
        ? { ...s, chips: s.chips.map((c) => (c.id === p.id ? { ...c, state: 'confirmed' } : c)) }
        : s;
    }
    case 'CONFIRM_RETRY': {
      const p = pendingChip(s);
      return p ? { ...s, chips: s.chips.filter((c) => c.id !== p.id) } : s;
    }
    case 'CLEAR':
      return {
        ...s,
        chips: [],
        sentence: null,
        composingIds: [],
        sentenceIds: [],
        composing: false,
        speaking: false,
        problems: withoutProblem(withoutProblem(s.problems, 'notRecognised'), 'voiceUnavailable'),
      };
    case 'COMPOSE_START':
      return s.chips.length ? { ...s, composing: true, composingIds: s.chips.map((c) => c.id) } : s;
    case 'COMPOSED':
      return {
        ...s,
        composing: false,
        sentence: e.sentence,
        sentenceIds: s.composingIds,
        composingIds: [],
        problems: withoutProblem(s.problems, 'offline'),
      };
    case 'COMPOSE_FAILED':
      return {
        ...s,
        composing: false,
        composingIds: [],
        problems: withProblem(s.problems, e.retryable ? 'offline' : 'notRecognised'),
      };
    case 'SPEAK_START':
      return s.sentence
        ? {
            ...s,
            speaking: true,
            caption: s.sentence,
            problems: withoutProblem(s.problems, 'voiceUnavailable'),
          }
        : s;
    case 'SPOKEN':
      return {
        ...s,
        speaking: false,
        sentence: null,
        // Only the signs that made up this sentence go; signs made while it was being spoken stay.
        chips: s.chips.filter((c) => !s.sentenceIds.includes(c.id)),
        sentenceIds: [],
        problems: withoutProblem(withoutProblem(s.problems, 'offline'), 'voiceUnavailable'),
      };
    case 'SPEAK_FAILED':
      // The sentence stays, so the signer can press Speak again.
      return {
        ...s,
        speaking: false,
        problems: withProblem(
          s.problems,
          e.reason === 'network'
            ? 'offline'
            : e.reason === 'noChannel'
              ? 'voiceUnavailable'
              : 'notRecognised',
        ),
      };
    case 'CAPTION_CLEAR':
      return { ...s, caption: null };
    case 'MIC_MUTED':
      return { ...s, micMuted: e.muted };
    case 'NOTICE':
      return { ...s, notice: e.text };
    case 'LIGHT':
      return {
        ...s,
        problems: e.dark
          ? withProblem(s.problems, 'lowLight')
          : withoutProblem(s.problems, 'lowLight'),
      };
    case 'HANDS_EDGE':
      return {
        ...s,
        problems: e.out
          ? withProblem(s.problems, 'handsOut')
          : withoutProblem(s.problems, 'handsOut'),
      };
    case 'ONLINE':
      return {
        ...s,
        problems: e.online
          ? withoutProblem(s.problems, 'offline')
          : withProblem(s.problems, 'offline'),
      };
    case 'DISMISS':
      return { ...s, problems: withoutProblem(s.problems, e.problem) };
  }
}

/** Main phase, derived from the flags so the two can never disagree. */
export function phaseOf(s: MachineState): Phase {
  if (!s.on) return 'off';
  if (s.starting) return 'starting';
  if (s.speaking) return 'speaking';
  if (s.sentence !== null) return 'sentence';
  if (s.composing) return 'composing';
  if (s.signing) return 'signing';
  if (s.inFlight > 0) return 'recognising';
  if (s.handsVisible) return 'seeing';
  if (s.chips.length) return 'chips';
  return 'ready';
}

export interface View {
  status: Status;
  label: string;
  /** Extra guidance shown under the status (also announced politely). */
  hint?: string;
  /** Dominant problem, if any. */
  problem?: Problem;
}

const PHASE_VIEW: Record<Phase, { status: Status; label: string }> = {
  off: { status: 'off', label: 'Off' },
  starting: { status: 'starting', label: 'Starting camera' },
  ready: { status: 'ready', label: 'Ready' },
  seeing: { status: 'seeing', label: 'Seeing you' },
  signing: { status: 'signing', label: 'Signing' },
  recognising: { status: 'recognising', label: 'Recognising' },
  chips: { status: 'ready', label: 'Ready' },
  composing: { status: 'recognising', label: 'Writing your sentence' },
  sentence: { status: 'ready', label: 'Sentence ready' },
  speaking: { status: 'speaking', label: 'Speaking' },
};

/** Problems in priority order: the first present one wins the status line. */
const PROBLEM_VIEW: Array<[Problem, { status: Status; label: string; hint: string }]> = [
  [
    'cameraBlocked',
    {
      status: 'attention',
      label: 'Camera blocked',
      hint: 'Allow camera access for Meet in Chrome, then try again.',
    },
  ],
  [
    'offline',
    {
      status: 'reconnecting',
      label: 'Reconnecting…',
      hint: 'Your signs are saved and will be sent when the connection returns.',
    },
  ],
  [
    'voiceUnavailable',
    {
      status: 'attention',
      label: 'Voice not connected',
      hint: 'Reload this Meet tab once so Audion can speak in the call.',
    },
  ],
  [
    'notRecognised',
    { status: 'attention', label: 'Couldn’t recognize that', hint: 'Try again slowly.' },
  ],
  ['lowLight', { status: 'attention', label: 'Poor lighting', hint: 'Move to a brighter spot.' }],
  [
    'handsOut',
    {
      status: 'attention',
      label: 'Hands out of frame',
      hint: 'Keep your hands inside the outline.',
    },
  ],
];

export function viewOf(s: MachineState): View {
  for (const [problem, v] of PROBLEM_VIEW) {
    if (s.problems.includes(problem)) return { ...v, problem };
  }
  return PHASE_VIEW[phaseOf(s)];
}

export const ALL_PHASES: Phase[] = [
  'off',
  'starting',
  'ready',
  'seeing',
  'signing',
  'recognising',
  'chips',
  'composing',
  'sentence',
  'speaking',
];
export const ALL_PROBLEMS: Problem[] = [
  'lowLight',
  'handsOut',
  'notRecognised',
  'offline',
  'cameraBlocked',
  'voiceUnavailable',
];
export { PHASE_VIEW, PROBLEM_VIEW };

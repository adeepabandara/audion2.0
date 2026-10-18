import type { PipelineEvent, Stamped } from './model';

/** One line of the live feed, in plain words. */
export interface FeedLine {
  id: number;
  /** Epoch ms. */
  at: number;
  text: string;
  /** From the "play a sample" button, not from real use. */
  simulated: boolean;
  kind: PipelineEvent['kind'];
}

export interface ApiCall {
  path: string;
  ok: boolean;
  ms: number;
  at: number;
}

export interface Stats {
  /** Hand-tracking frames per second over the last two seconds. */
  fps: number;
  hands: number;
  signing: boolean;
  signs: number;
  unsure: number;
  lastSign: { sign: string; confidence: number; ms: number } | null;
  cloudChecks: number;
  lastCloud: { sign: string; ms: number; role: 'check' | 'answer'; deviceSign?: string } | null;
  sentences: number;
  lastSentence: { sentence: string; writer: string; ms: number } | null;
  voices: number;
  lastVoice: { voiceId: string; ms: number } | null;
  voiceChecks: number;
  lastVoiceCheck: { heard: string; ms: number; mode: string } | null;
  contexts: number;
  lastContext: { summary: string; ms: number; chars: number } | null;
  captions: number;
  apiCount: number;
  /** The most recent calls to the API, newest first (at most 6). */
  apiCalls: ApiCall[];
  gemma: string;
  service: { mode: string; modelId: string; voices: string } | null;
  /** Newest first, at most 40. */
  feed: FeedLine[];
}

export const emptyStats = (): Stats => ({
  fps: 0,
  hands: 0,
  signing: false,
  signs: 0,
  unsure: 0,
  lastSign: null,
  cloudChecks: 0,
  lastCloud: null,
  sentences: 0,
  lastSentence: null,
  voices: 0,
  lastVoice: null,
  voiceChecks: 0,
  lastVoiceCheck: null,
  contexts: 0,
  lastContext: null,
  captions: 0,
  apiCount: 0,
  apiCalls: [],
  gemma: 'off',
  service: null,
  feed: [],
});

const FEED_MAX = 40;
const FPS_WINDOW_MS = 2000;
const pct = (c: number) => `${Math.round(c * 100)}%`;
const time = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

const API_NAMES: Record<string, string> = {
  'api/recognize': 'Recognise a sign',
  'api/compose': 'Write a sentence',
  'api/speak': 'Speak',
  'api/voiceCheck': 'Check the voice',
  'api/translate': 'Translate',
  'api/context': 'Summarise the meeting',
  'api/health': 'Check the service',
  'api/feedback': 'Send feedback',
};
export const apiName = (path: string) => API_NAMES[path] ?? path;

/** What else the model was weighing, what it had to go on, and (when it looks like the cause) a plain hint. */
export function signDetail(e: {
  confidence: number;
  top?: Array<{ sign: string; confidence: number }>;
  frames?: number;
  hands?: number;
}): string {
  const parts: string[] = [];
  if (e.top && e.top.length > 1)
    parts.push(
      `Also considered: ${e.top
        .slice(1)
        .map((t) => `${t.sign} ${pct(t.confidence)}`)
        .join(', ')}.`,
    );
  if (e.frames !== undefined && e.hands !== undefined)
    parts.push(`It saw ${e.frames} frames with ${e.hands} hand${e.hands === 1 ? '' : 's'}.`);
  // Found by replaying real clips: a resting second hand in view pulls one-handed signs towards other signs, and a sign
  // cut short (only its first part) looks like a different one.
  if (e.confidence < 0.85) {
    if ((e.hands ?? 0) >= 2)
      parts.push(
        'Both hands were in view: for a one-handed sign, keep the other hand out of the picture.',
      );
    if (e.frames !== undefined && e.frames < 10)
      parts.push('That was a very short sign: sign a little slower so all of it is seen.');
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/** What an event says, in plain words, for the live feed. Null for events too frequent or dull to list. */
export function describe(e: PipelineEvent): string | null {
  switch (e.kind) {
    case 'device':
      return `Sign “${e.sign}” named on this device (${pct(e.confidence)} sure, ${time(e.ms)}).${signDetail(e)}`;
    case 'device-unsure':
      return `Sign model unsure (“${e.sign}”, ${pct(e.confidence)}): not accepted.${signDetail(e)}`;
    case 'cloud':
      if (e.role === 'answer') return `Gemini named the sign “${e.sign}” (${time(e.ms)}).`;
      return e.sign === e.deviceSign
        ? `Gemini double-check agreed: “${e.sign}” (${time(e.ms)}).`
        : `Gemini double-check: “${e.sign}” instead of “${e.deviceSign ?? '?'}” (${time(e.ms)}).`;
    case 'sentence':
      return `Sentence “${e.sentence}” written by ${e.writer} (${time(e.ms)}).`;
    case 'translate':
      return `Translated to ${e.language} (${time(e.ms)}).`;
    case 'voice':
      return `Spoken aloud with Google Text-to-Speech, voice ${e.voiceId} (${time(e.ms)}).`;
    case 'voice-check':
      return e.mode === 'mock'
        ? `Voice check (test mode, nothing really checked) (${time(e.ms)}).`
        : `Speech-to-Text heard “${e.heard || 'nothing'}” (${time(e.ms)}).`;
    case 'context':
      return `Meeting summary updated from ${e.chars} characters of captions (${time(e.ms)}).`;
    case 'caption':
      return `Caption · ${e.speaker}: ${e.text}`;
    case 'api':
      return `${apiName(e.path)}: ${e.ok ? 'ok' : 'failed'} in ${time(e.ms)}.`;
    case 'gemma':
      return `Gemma on this device: ${e.state}.`;
    case 'signing':
    case 'frame':
    case 'service':
      return null;
  }
}

/** The new statistics after an event. Pure: `frames` is only used by the bus to count frames per second. */
export function reduce(s: Stats, e: Stamped, at: number, nextId: () => number): Stats {
  let n: Stats = s;
  switch (e.kind) {
    case 'frame':
      n = { ...s, hands: e.hands };
      break;
    case 'signing':
      n = { ...s, signing: e.on };
      break;
    case 'device':
      n = {
        ...s,
        signs: s.signs + 1,
        lastSign: { sign: e.sign, confidence: e.confidence, ms: e.ms },
      };
      break;
    case 'device-unsure':
      n = { ...s, unsure: s.unsure + 1 };
      break;
    case 'cloud':
      n = {
        ...s,
        cloudChecks: s.cloudChecks + 1,
        lastCloud: {
          sign: e.sign,
          ms: e.ms,
          role: e.role,
          ...(e.deviceSign ? { deviceSign: e.deviceSign } : {}),
        },
      };
      break;
    case 'sentence':
      n = {
        ...s,
        sentences: s.sentences + 1,
        lastSentence: { sentence: e.sentence, writer: e.writer, ms: e.ms },
      };
      break;
    case 'voice':
      n = { ...s, voices: s.voices + 1, lastVoice: { voiceId: e.voiceId, ms: e.ms } };
      break;
    case 'voice-check':
      n = {
        ...s,
        voiceChecks: s.voiceChecks + 1,
        lastVoiceCheck: { heard: e.heard, ms: e.ms, mode: e.mode },
      };
      break;
    case 'context':
      n = {
        ...s,
        contexts: s.contexts + 1,
        lastContext: { summary: e.summary, ms: e.ms, chars: e.chars },
      };
      break;
    case 'caption':
      n = { ...s, captions: s.captions + 1 };
      break;
    case 'api':
      n = {
        ...s,
        apiCount: s.apiCount + 1,
        apiCalls: [{ path: e.path, ok: e.ok, ms: e.ms, at }, ...s.apiCalls].slice(0, 6),
      };
      break;
    case 'gemma':
      n = { ...s, gemma: e.state };
      break;
    case 'service':
      n = { ...s, service: { mode: e.mode, modelId: e.modelId, voices: e.voices } };
      break;
  }
  const text = describe(e);
  if (text) {
    const line: FeedLine = {
      id: nextId(),
      at,
      text: e.simulated ? `(sample) ${text}` : text,
      simulated: !!e.simulated,
      kind: e.kind,
    };
    n = { ...n, feed: [line, ...n.feed].slice(0, FEED_MAX) };
  }
  return n;
}

type EventListener = (e: Stamped, at: number) => void;

/**
 * Collects what really happens in the page (hand-tracking frames, signs, API calls, sentences, voice, summaries)
 * for the "behind the scenes" view. It records all the time, cheaply, so the view shows history when it opens.
 * `onEvent` is immediate (for the flowing dots); `subscribe` is calmer (for numbers and the feed).
 */
export class PipelineBus {
  private stats = emptyStats();
  private frameTimes: number[] = [];
  private id = 0;
  private readonly eventListeners = new Set<EventListener>();
  private readonly statListeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly notifyEveryMs = 150) {}

  emit(e: Stamped, at = Date.now()): void {
    if (e.kind === 'frame') {
      this.frameTimes.push(at);
      while (this.frameTimes.length && at - this.frameTimes[0]! > FPS_WINDOW_MS)
        this.frameTimes.shift();
    }
    this.stats = reduce(this.stats, e, at, () => ++this.id);
    this.eventListeners.forEach((l) => l(e, at));
    if (this.timer === undefined) {
      this.timer = setTimeout(() => this.flush(), this.notifyEveryMs);
    }
  }

  /** Tell the statistics listeners now (otherwise they hear within `notifyEveryMs`). */
  flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.statListeners.forEach((l) => l());
  }

  snapshot(now = Date.now()): Stats {
    const recent = this.frameTimes.filter((t) => now - t <= FPS_WINDOW_MS).length;
    return { ...this.stats, fps: Math.round((recent / (FPS_WINDOW_MS / 1000)) * 10) / 10 };
  }

  onEvent(l: EventListener): () => void {
    this.eventListeners.add(l);
    return () => this.eventListeners.delete(l);
  }

  subscribe(l: () => void): () => void {
    this.statListeners.add(l);
    return () => this.statListeners.delete(l);
  }
}

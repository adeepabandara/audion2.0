/**
 * The architecture of Ola as the "behind the scenes" view draws it: what each step is, where it runs, and which
 * route a piece of data takes when a real event happens. Pure data and functions, so it is easy to test.
 */

export type Zone = 'device' | 'cloud';

export type NodeId =
  | 'camera'
  | 'mediapipe'
  | 'segmenter'
  | 'classifier'
  | 'sentence'
  | 'captions'
  | 'context'
  | 'api'
  | 'gemini'
  | 'tts'
  | 'speaker'
  | 'profile'
  | 'stt';

export type IconKey =
  | 'camera'
  | 'points'
  | 'segment'
  | 'net'
  | 'sentence'
  | 'captions'
  | 'context'
  | 'server'
  | 'chip'
  | 'wave'
  | 'speaker'
  | 'voice'
  | 'listen';

export interface PipelineNode {
  id: NodeId;
  icon: IconKey;
  zone: Zone;
  title: string;
  /** One line under the title. */
  subtitle: string;
  /** Centre in the diagram's 1440 x 900 space. */
  x: number;
  y: number;
  /** What it is, in plain words (shown in the side panel). */
  what: string;
  /** What data goes in and out, and what it never sees. */
  data: string;
}

export const CANVAS = { w: 1440, h: 900 };
export const NODE_W = 184;
export const NODE_H = 88;

export const NODES: PipelineNode[] = [
  {
    id: 'camera',
    icon: 'camera',
    zone: 'device',
    title: 'Camera',
    subtitle: 'your webcam',
    x: 120,
    y: 200,
    what: 'Your webcam, or the video file you picked in the test box. Frames are handled in your browser’s memory.',
    data: 'Video frames go to hand tracking and nowhere else. Nothing is recorded or uploaded for this step.',
  },
  {
    id: 'mediapipe',
    icon: 'points',
    zone: 'device',
    title: 'Hand tracking',
    subtitle: 'MediaPipe',
    x: 396,
    y: 200,
    what: 'Google’s open MediaPipe Hand Landmarker model, running inside your browser. It finds 21 points on each hand about 15 times a second.',
    data: 'Takes pictures, gives back only numbers: the positions of hand points. It does not identify anyone.',
  },
  {
    id: 'segmenter',
    icon: 'segment',
    zone: 'device',
    title: 'Sign detector',
    subtitle: 'simple rules',
    x: 672,
    y: 200,
    what: 'Simple rules, not AI: it notices when your hands start moving and when they rest, and cuts out one sign (between about 0.6 and 4 seconds).',
    data: 'Hand points in, “one sign” out (the hand points of that sign). It also records a short clip, kept only if the optional Gemini check is on.',
  },
  {
    id: 'classifier',
    icon: 'net',
    zone: 'device',
    title: 'Sign model',
    subtitle: 'small neural net',
    x: 948,
    y: 200,
    what: 'A small neural network (a GRU) trained on 2,200 sign clips. It names the sign from the hand points in a few milliseconds. About 84% right on people it was not trained on; it only answers when it is at least 50% sure.',
    data: 'Hand points in, a sign word and a confidence out. No video, no internet.',
  },
  {
    id: 'sentence',
    icon: 'sentence',
    zone: 'device',
    title: 'Sentence writer',
    subtitle: 'Gemma · Gemini',
    x: 948,
    y: 420,
    what: 'Gemma 4, Google’s open model, writes the sentence in your browser once it has loaded (a 2 GB download kept in the browser). Until then, or if your browser cannot run it, Gemini writes it. A safety check throws away any word that was not signed (or is not in the meeting summary).',
    data: 'Signs (and the meeting summary) in, one English sentence out. On device with Gemma; a request to the API with Gemini.',
  },
  {
    id: 'captions',
    icon: 'captions',
    zone: 'device',
    title: 'Meeting captions',
    subtitle: 'Meet CC or demo',
    x: 120,
    y: 420,
    what: 'In a real Meet call, the live captions on screen. In this demo, a short made-up conversation plays so you can see the feature.',
    data: 'Other people’s words. Only used if you turn on the meeting context; never stored.',
  },
  {
    id: 'context',
    icon: 'context',
    zone: 'device',
    title: 'Meeting context',
    subtitle: 'from captions',
    x: 396,
    y: 420,
    what: 'Keeps recent captions in memory and, every so often, asks Gemini for a short summary of what is being discussed. The summary helps word your sentence.',
    data: 'Caption text out (only when the setting is on); a summary of at most 1,200 characters back. Forgotten when Ola turns off.',
  },
  {
    id: 'api',
    icon: 'server',
    zone: 'cloud',
    title: 'Ola API',
    subtitle: 'Cloud Run',
    x: 1260,
    y: 420,
    what: 'One small service on Google Cloud Run. It checks every request, rate-limits it, and calls Gemini or Text-to-Speech. It serves this page too.',
    data: 'Never stores or logs video, captions or sentences (a test checks the captions are never logged). Per-person limits and a daily cap protect the cost.',
  },
  {
    id: 'gemini',
    icon: 'chip',
    zone: 'cloud',
    title: 'Gemini',
    subtitle: 'Vertex AI',
    x: 1260,
    y: 200,
    what: 'Google’s Gemini model. Used for three things: summarising the meeting captions, writing a sentence when Gemma is not ready, and (optional) double-checking a sign from a short video clip with a model tuned on sign videos.',
    data: 'Text prompts in, text out. A video clip goes in only if “Have Gemini double-check signs” is on.',
  },
  {
    id: 'tts',
    icon: 'wave',
    zone: 'cloud',
    title: 'Text-to-Speech',
    subtitle: 'Google Cloud',
    x: 1260,
    y: 640,
    what: 'Google Cloud Text-to-Speech. It turns the sentence into spoken audio with the voice you chose.',
    data: 'The sentence in, an MP3 out. Common one-word phrases are cached.',
  },
  {
    id: 'speaker',
    icon: 'speaker',
    zone: 'device',
    title: 'Speakers',
    subtitle: 'or call mic',
    x: 948,
    y: 640,
    what: 'Plays the audio on your device. In the Chrome extension on a real Meet call, the voice is also mixed into your microphone so the other people hear it.',
    data: 'Audio in. Nothing leaves your device from here.',
  },
  {
    id: 'profile',
    icon: 'voice',
    zone: 'device',
    title: 'Voice profile',
    subtitle: 'your voice setup',
    x: 672,
    y: 780,
    what: 'Your voice, set up from a few questions: which Google voice, how much higher or lower, and how fast. It is saved on your device and travels with every sentence, so Ola always sounds like you.',
    data: 'Voice name, pitch and pace (three small values). No audio and no personal details.',
  },
  {
    id: 'stt',
    icon: 'listen',
    zone: 'cloud',
    title: 'Speech-to-Text',
    subtitle: 'Google Cloud',
    x: 1260,
    y: 780,
    what: 'Google Cloud Speech-to-Text. During voice setup it listens to a sample of your voice and says what it heard, so you can see, in words, how clear the voice is for the people you talk to.',
    data: 'A short sample in the chosen voice goes in, text comes out. The audio stays on the server and is not stored.',
  },
];

export type EdgeId =
  | 'cam-mp'
  | 'mp-seg'
  | 'seg-clf'
  | 'clf-sent'
  | 'seg-api'
  | 'api-gem'
  | 'cap-ctx'
  | 'ctx-sent'
  | 'ctx-api'
  | 'sent-api'
  | 'api-tts'
  | 'tts-spk'
  | 'prof-tts'
  | 'tts-stt'
  | 'stt-prof';

/** The kinds of data, which the legend colours. */
export type DataKind = 'video' | 'points' | 'signs' | 'text' | 'audio' | 'context';

export interface PipelineEdge {
  id: EdgeId;
  /** SVG path in the canvas space, drawn from the source to the target. */
  d: string;
  label: string;
  kind: DataKind;
  /** Optional: only used when a setting is on (drawn dashed). */
  optional?: boolean;
  /** Where the label sits. */
  lx: number;
  ly: number;
  /** Text anchor of the label (default: middle). */
  anchor?: 'start' | 'middle';
}

export const EDGES: PipelineEdge[] = [
  { id: 'cam-mp', d: 'M212 200 L304 200', label: 'video', kind: 'video', lx: 258, ly: 188 },
  { id: 'mp-seg', d: 'M488 200 L580 200', label: 'hand points', kind: 'points', lx: 534, ly: 188 },
  { id: 'seg-clf', d: 'M764 200 L856 200', label: 'one sign', kind: 'points', lx: 810, ly: 188 },
  {
    id: 'clf-sent',
    d: 'M948 244 L948 376',
    label: 'sign + confidence',
    kind: 'signs',
    lx: 966,
    ly: 314,
    anchor: 'start',
  },
  {
    id: 'seg-api',
    d: 'M672 156 L672 130 L1392 130 L1392 420 L1352 420',
    label: 'video clip (optional check)',
    kind: 'video',
    optional: true,
    lx: 880,
    ly: 120,
  },
  {
    id: 'api-gem',
    d: 'M1260 376 L1260 244',
    label: 'prompts',
    kind: 'text',
    lx: 1278,
    ly: 314,
    anchor: 'start',
  },
  { id: 'cap-ctx', d: 'M212 420 L304 420', label: 'captions', kind: 'context', lx: 258, ly: 408 },
  {
    id: 'ctx-sent',
    d: 'M488 420 L856 420',
    label: 'meeting summary',
    kind: 'context',
    optional: true,
    lx: 672,
    ly: 408,
  },
  {
    id: 'ctx-api',
    d: 'M396 464 L396 540 L1108 540 L1108 444 L1168 444',
    label: 'captions to summarise (opt-in)',
    kind: 'context',
    optional: true,
    lx: 750,
    ly: 530,
  },
  { id: 'sent-api', d: 'M1040 420 L1168 420', label: 'text', kind: 'text', lx: 1104, ly: 408 },
  {
    id: 'api-tts',
    d: 'M1260 464 L1260 596',
    label: 'text',
    kind: 'text',
    lx: 1278,
    ly: 536,
    anchor: 'start',
  },
  { id: 'tts-spk', d: 'M1168 640 L1040 640', label: 'audio', kind: 'audio', lx: 1104, ly: 628 },
  {
    id: 'prof-tts',
    d: 'M764 766 L1108 766 L1108 664 L1168 664',
    label: 'voice, pitch, pace',
    kind: 'signs',
    lx: 936,
    ly: 756,
  },
  {
    id: 'tts-stt',
    d: 'M1260 684 L1260 736',
    label: 'sample',
    kind: 'audio',
    optional: true,
    lx: 1278,
    ly: 714,
    anchor: 'start',
  },
  {
    id: 'stt-prof',
    d: 'M1168 800 L764 800',
    label: 'what people will hear',
    kind: 'text',
    optional: true,
    lx: 966,
    ly: 820,
  },
];

export const EDGE_BY_ID = Object.fromEntries(EDGES.map((e) => [e.id, e])) as Record<
  EdgeId,
  PipelineEdge
>;

/** What the on-device model saw for one sign (see `SignDetail` in panel/session.ts). */
export type SignDetail = {
  top?: Array<{ sign: string; confidence: number }>;
  frames?: number;
  hands?: number;
};

/** Everything that can happen, as the live view sees it. */
export type PipelineEvent =
  | { kind: 'frame'; hands: number }
  | { kind: 'signing'; on: boolean }
  | ({ kind: 'device'; sign: string; confidence: number; ms: number } & SignDetail)
  | ({
      kind: 'device-unsure';
      sign: string;
      confidence: number;
      ms: number;
      threshold?: number;
      then?: 'cloud' | 'retry';
    } & SignDetail)
  | { kind: 'cloud'; role: 'check' | 'answer'; sign: string; ms: number; deviceSign?: string }
  | { kind: 'sentence'; sentence: string; writer: string; ms: number }
  | { kind: 'translate'; language: string; ms: number }
  | { kind: 'voice'; voiceId: string; ms: number }
  | { kind: 'voice-check'; heard: string; ms: number; mode: string }
  | { kind: 'context'; summary: string; ms: number; chars: number }
  | { kind: 'caption'; speaker: string; text: string }
  | { kind: 'api'; path: string; ok: boolean; ms: number }
  | { kind: 'gemma'; state: string }
  | { kind: 'service'; mode: string; modelId: string; voices: string };

/** An event carries this when it comes from the "play a sample" button, not from real use. */
export type Stamped = PipelineEvent & { simulated?: boolean };

/** One step of a route: a packet runs along `edge` (backwards if `back`), starting `delay` ms after the event. */
export interface Hop {
  edge: EdgeId;
  back?: boolean;
  delay: number;
}

const HOP_MS = 650;

/** The nodes that light up for an event (also used when packets are switched off for reduced motion). */
export function nodesFor(e: PipelineEvent): NodeId[] {
  switch (e.kind) {
    case 'frame':
      return ['camera', 'mediapipe'];
    case 'signing':
      return ['segmenter'];
    case 'device':
    case 'device-unsure':
      return ['classifier'];
    case 'cloud':
      return ['api', 'gemini'];
    case 'sentence':
      return e.writer.toLowerCase().includes('gemma')
        ? ['sentence']
        : ['sentence', 'api', 'gemini'];
    case 'translate':
      return ['sentence', 'api', 'gemini'];
    case 'voice':
      return ['profile', 'api', 'tts', 'speaker'];
    case 'voice-check':
      return ['profile', 'tts', 'stt'];
    case 'context':
      return ['context', 'api', 'gemini'];
    case 'caption':
      return ['captions', 'context'];
    case 'api':
    case 'gemma':
    case 'service':
      return [];
  }
}

/** The route data takes for an event: which edges, in which order, and which way. */
export function routeFor(e: PipelineEvent): Hop[] {
  const chain = (hops: Array<[EdgeId, boolean?]>): Hop[] =>
    hops.map(([edge, back], i) => ({ edge, ...(back ? { back } : {}), delay: i * HOP_MS }));
  switch (e.kind) {
    case 'frame':
      return chain([['cam-mp'], ['mp-seg']]);
    case 'device':
    case 'device-unsure':
      return chain([
        ['seg-clf'],
        ...(e.kind === 'device' ? ([['clf-sent']] as Array<[EdgeId]>) : []),
      ]);
    case 'cloud':
      return chain([['seg-api'], ['api-gem'], ['api-gem', true]]);
    case 'sentence':
      return e.writer.toLowerCase().includes('gemma')
        ? []
        : chain([['sent-api'], ['api-gem'], ['api-gem', true], ['sent-api', true]]);
    case 'translate':
      return chain([['sent-api'], ['api-gem'], ['api-gem', true], ['sent-api', true]]);
    case 'voice':
      return chain([['sent-api'], ['api-tts'], ['prof-tts'], ['api-tts', true], ['tts-spk']]);
    case 'voice-check':
      return chain([['prof-tts'], ['tts-stt'], ['stt-prof']]);
    case 'context':
      return chain([['ctx-api'], ['api-gem'], ['api-gem', true], ['ctx-api', true], ['ctx-sent']]);
    case 'caption':
      return chain([['cap-ctx']]);
    default:
      return [];
  }
}

/** The colour class of the data on an edge, from the legend. */
export const KIND_LABEL: Record<DataKind, string> = {
  video: 'Video',
  points: 'Hand points',
  signs: 'Signs',
  text: 'Text',
  audio: 'Audio',
  context: 'Meeting context',
};

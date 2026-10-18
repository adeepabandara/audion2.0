import type { Scene } from '../browser/browserState';

/**
 * The guided steps: install the extension (1-2), join a meeting (3-4), get Ola ready (5-6), set up the voice (7-9), then play: sign a sentence and
 * hear it (10-11). Playing is last on purpose: when it ends the tour closes and the visitor carries on with everything open.
 * Each step has a short title and ONE short line that says what to do, because the popup is a nudge, not a manual.
 */
export type Placement = 'top' | 'bottom' | 'left' | 'right' | 'center';

/** What a step waits for before it moves on by itself. */
export type Wait =
  | 'installed' // the extension was added
  | 'pinned' // its icon is pinned to the toolbar
  | 'joined' // the visitor joined the meeting
  | 'panel-open' // Ola's card is open
  | 'ola-on' // Ola is switched on
  | 'ready' // the camera works and Ola is looking for hands
  | 'settings-open' // Ola's Settings are open
  | 'voice-setup' // the voice set-up questions are showing
  | 'voice-saved' // the visitor chose their voice
  | 'sentence' // the signs became a sentence
  | 'spoken'; // Ola has said it aloud

export interface CoachStep {
  id: string;
  title: string;
  /** One short line: what to do (or, for the last step, what is next). */
  text: string;
  placement: Placement;
  /**
   * CSS selector(s) for the exact thing to click or look at, looked up in the page and then inside Ola's widget. With
   * several, the first one that is there wins (so a step can follow the visitor from one control to the next).
   */
  target?: string | string[];
  /** Open the "Try these signs" guide when this step starts (it then stays until the visitor closes it). */
  guide?: boolean;
  /** Which page of the browser window this step happens on. */
  scene: Scene;
  /** How far the view zooms in on the target (1 = no zoom). Small things get the most, never more than 2x. */
  zoom: number;
  waitFor?: Wait;
  /** Show an animated pointer that glides to the target and clicks it, for steps where the visitor must click. */
  demo?: 'click';
  /**
   * Dim everything but the target and block clicks elsewhere (default). Off: the whole page stays in view and usable, which
   * the install step and the two playing steps need (the visitor must be free to click, and to keep signing).
   */
  focus?: boolean;
}

/**
 * Five everyday sentences to try, each made of signs the on-device model recognises reliably (held-out test clips: WAIT
 * 100%, PLEASE 96%, NO 92%, THANK YOU 92%, BYE 92%, YES 88%, HELLO 88%, FINE 84%, and the two-sign phrases 92-100%). They
 * are the sentences the product already knows for these signs, so what Ola says is predictable (it may word one a little
 * differently).
 */
export interface PracticeSentence {
  /** What it means, and what Ola is expected to say. */
  says: string;
  /** The signs to make, in order. */
  signs: string[];
}
export const PRACTICE_SENTENCES: PracticeSentence[] = [
  { says: 'Hello, please wait.', signs: ['hello', 'please', 'wait'] },
  { says: 'Yes, please.', signs: ['yes', 'please'] },
  { says: 'No, thank you.', signs: ['no', 'thankyou'] },
  { says: "I'm fine, thank you.", signs: ['fine', 'thankyou'] },
  { says: 'Thank you, goodbye.', signs: ['thankyou', 'bye'] },
];

/** Every sign used by those sentences, once. */
export const PRACTICE_SIGNS = [...new Set(PRACTICE_SENTENCES.flatMap((p) => p.signs))];

/**
 * How the hand MOVES in each of those signs, drawn as a small arrow next to the hand shape and acted out by the hand
 * picture. Several signs share a hand shape (HELLO and PLEASE are both a flat hand), so the place and the movement are
 * what tell them apart.
 */
export type Motion = 'outward' | 'circle' | 'wiggle' | 'down' | 'wave' | 'nod' | 'tap';
export const SIGN_MOTION: Record<string, Motion> = {
  hello: 'outward', // from the forehead, away from you
  please: 'circle', // a small circle on the chest
  wait: 'wiggle', // fingers wiggling
  thankyou: 'down', // from the chin, forward and down
  bye: 'wave', // side to side
  yes: 'nod', // a fist nodding up and down
  no: 'tap', // two fingers tap down onto the thumb
  fine: 'tap', // the thumb taps the chest
};

export const COACH_STEPS: CoachStep[] = [
  {
    id: 'add',
    title: 'Add Ola to your browser',
    text: 'Click Add to Chrome, then Add extension.',
    placement: 'bottom',
    target: ['#store-confirm', '#store-add'],
    scene: 'store',
    zoom: 1,
    waitFor: 'installed',
    demo: 'click',
    focus: false,
  },
  {
    id: 'pin',
    title: 'Pin Ola',
    text: 'Open the puzzle piece, then pin Ola.',
    placement: 'bottom',
    target: ['#ext-pin', '#toolbar-puzzle'],
    scene: 'store',
    zoom: 2,
    waitFor: 'pinned',
    demo: 'click',
  },
  {
    id: 'join',
    title: 'Join the meeting',
    text: 'Click Join now.',
    placement: 'left',
    target: '#join-btn',
    scene: 'join',
    zoom: 1.5,
    waitFor: 'joined',
    demo: 'click',
  },
  {
    id: 'open',
    title: 'Ola is in your call',
    text: 'It appears in every call. Click it to open.',
    placement: 'top',
    target: '.ap-pill .au-btn',
    scene: 'call',
    // The first look at Ola in the call: the whole window stays in view, so the popup is never cut off.
    zoom: 1,
    waitFor: 'panel-open',
    demo: 'click',
  },
  {
    id: 'on',
    title: 'Turn Ola on',
    text: 'Switch it on, then allow the camera every visit.',
    placement: 'left',
    target: '.ap-card__head .au-switch',
    scene: 'call',
    // No zoom while the camera starts: the browser's permission prompt and the camera picture both stay in view.
    zoom: 1,
    waitFor: 'ola-on',
    demo: 'click',
  },
  {
    id: 'ready',
    title: 'Camera ready',
    text: 'Wait for Ready, then raise your hands.',
    placement: 'left',
    target: '.ap-card__head .au-pill',
    scene: 'call',
    zoom: 1,
    waitFor: 'ready',
  },
  {
    id: 'settings',
    title: 'Open Settings',
    text: 'Click the cog.',
    placement: 'top',
    target: '.ap-foot .au-btn:last-of-type',
    scene: 'call',
    zoom: 2,
    waitFor: 'settings-open',
    demo: 'click',
  },
  {
    id: 'voice',
    title: 'Set up your voice',
    text: 'Click Set up my voice.',
    placement: 'left',
    target: '.au-drawer section[aria-label="My voice"] button',
    scene: 'call',
    // No zoom: the Settings drawer is tall, and a zoom could leave the button below the bottom of a short screen.
    zoom: 1,
    waitFor: 'voice-setup',
    demo: 'click',
  },
  {
    id: 'voice-pick',
    title: 'Choose how you sound',
    text: 'Answer the questions, then click Use this voice.',
    placement: 'left',
    target: '.au-drawer .vs',
    scene: 'call',
    zoom: 1,
    waitFor: 'voice-saved',
    focus: false,
  },
  {
    id: 'sign',
    title: 'Now you try',
    text: 'Pick a sentence in the guide and sign it.',
    guide: true,
    placement: 'left',
    target: '.ap-preview',
    scene: 'call',
    zoom: 1,
    waitFor: 'sentence',
    focus: false,
  },
  {
    id: 'speak',
    title: 'Ola speaks for you',
    text: 'Turn your sound on. Ola says it aloud.',
    placement: 'left',
    target: '.ap-sentence-wrap',
    scene: 'call',
    zoom: 1,
    waitFor: 'spoken',
    focus: false,
  },
];

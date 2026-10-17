/** The guided steps inside the call, and how each finds the thing it points at. */
export type Placement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface CoachStep {
  id: string;
  title: string;
  body: string;
  /** What to do, for steps that wait for the visitor to act. */
  hint?: string;
  placement: Placement;
  /** A CSS selector for the highlighted thing (looked up in the page, then inside Ola's widget). */
  target?: string;
  /** The step moves on by itself once the visitor has done this. */
  waitFor?: 'panel-open' | 'ola-on' | 'first-sign';
  nextLabel?: string;
}

export const COACH_STEPS: CoachStep[] = [
  {
    id: 'join',
    title: 'You’re about to join a team call',
    body: 'This is a simulated video call, so you can try Ola without a real meeting. Ola works the same way inside Google Meet, as a Chrome extension.',
    placement: 'center',
    nextLabel: 'Join the call',
  },
  {
    id: 'open',
    title: 'Open Ola',
    body: 'Ola sits in your browser’s toolbar and as a small widget in the call. Open it.',
    hint: 'Click the highlighted Ola button.',
    placement: 'bottom',
    target: '#toolbar-ola',
    waitFor: 'panel-open',
  },
  {
    id: 'on',
    title: 'Turn Ola on',
    body: 'Ola only uses your camera while it is on. Hand tracking runs on your device, and your video is never stored.',
    hint: 'Switch Ola on. Your browser will ask for the camera.',
    placement: 'left',
    target: '.ap-card__head .au-switch',
    waitFor: 'ola-on',
    nextLabel: 'Skip step',
  },
  {
    id: 'sign',
    title: 'Sign to the camera',
    body: 'Try HELLO, then PLEASE, one sign at a time. The dots follow your hands, and each sign Ola recognises appears as a chip.',
    hint: 'No camera, or can’t sign? Choose Next. The “behind the scenes” view has a sample run.',
    placement: 'left',
    target: '.ap-preview',
    waitFor: 'first-sign',
    nextLabel: 'Next',
  },
  {
    id: 'sentence',
    title: 'Your signs become a sentence',
    body: 'After a short pause, Ola joins your signs into one natural sentence, written by Gemma on your device or by Gemini, and speaks it in your voice.',
    placement: 'left',
    target: '.ap-sentence-wrap',
  },
  {
    id: 'context',
    title: 'It follows the meeting',
    body: 'With meeting context on, Ola reads the call’s captions and keeps a short summary to word your sentences better. Hover this badge to see what it has picked up.',
    placement: 'left',
    target: '.ap-ctx',
  },
  {
    id: 'language',
    title: 'Speak another language',
    body: 'Pick a language and Ola translates each sentence and speaks it in that language.',
    placement: 'top',
    target: '.ap-foot .au-langbtn',
  },
  {
    id: 'settings',
    title: 'Make it yours',
    body: 'Settings has your voice (answer a few questions, then hear, see and check it), the signs Ola knows, captions and privacy.',
    placement: 'top',
    target: '.ap-foot .au-btn:last-of-type',
  },
  {
    id: 'behind',
    title: 'See what’s really happening',
    body: 'This view shows the real data flowing through Gemini, Gemma, Google TTS and the rest, live. That’s the tour. Enjoy Ola.',
    placement: 'top',
    target: '#open-architecture',
    nextLabel: 'Finish',
  },
];

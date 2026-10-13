import { SIGNS, type Sign } from '@audion/shared';

export type Digit = 'up' | 'bent' | 'curl';
export type Thumb = 'out' | 'up' | 'across';
export interface Handshape {
  /** index, middle, ring, pinky */
  fingers: [Digit, Digit, Digit, Digit];
  spread: boolean;
  thumb: Thumb;
}
export type Place = 'forehead' | 'eye' | 'ear' | 'cheek' | 'chin' | 'chest' | 'wrist' | 'space';

const U = 'up';
const B = 'bent';
const C = 'curl';

export const SHAPES = {
  flat: { fingers: [U, U, U, U], spread: false, thumb: 'across' },
  open: { fingers: [U, U, U, U], spread: true, thumb: 'out' },
  fist: { fingers: [C, C, C, C], spread: false, thumb: 'across' },
  fistThumb: { fingers: [C, C, C, C], spread: false, thumb: 'up' },
  one: { fingers: [U, C, C, C], spread: false, thumb: 'across' },
  two: { fingers: [U, U, C, C], spread: false, thumb: 'across' },
  vee: { fingers: [U, U, C, C], spread: true, thumb: 'across' },
  ell: { fingers: [U, C, C, C], spread: false, thumb: 'out' },
  why: { fingers: [C, C, C, U], spread: false, thumb: 'out' },
  cup: { fingers: [B, B, B, B], spread: false, thumb: 'out' },
  claw: { fingers: [B, B, B, B], spread: true, thumb: 'out' },
} as const satisfies Record<string, Handshape>;

export interface SignInfo {
  shape: Handshape;
  place: Place;
  /** One short sentence, plain language. A reminder, not a lesson. */
  hint: string;
}

/** Display names where the label should differ from the vocabulary key. */
export const SIGN_LABEL: Partial<Record<Sign, string>> = { thankyou: 'thank you' };

export const SIGN_INFO: Record<Sign, SignInfo> = {
  hello: {
    shape: SHAPES.flat,
    place: 'forehead',
    hint: 'Flat hand at your forehead, move it outward like a salute.',
  },
  bye: { shape: SHAPES.open, place: 'space', hint: 'Open hand, wave it side to side.' },
  yes: { shape: SHAPES.fist, place: 'space', hint: 'Fist nods up and down, like a head nodding.' },
  no: {
    shape: SHAPES.two,
    place: 'space',
    hint: 'Index and middle fingers tap down onto your thumb.',
  },
  please: {
    shape: SHAPES.flat,
    place: 'chest',
    hint: 'Flat hand rubs a small circle on your chest.',
  },
  thankyou: {
    shape: SHAPES.flat,
    place: 'chin',
    hint: 'Fingertips at your chin, move forward and down.',
  },
  wait: {
    shape: SHAPES.open,
    place: 'space',
    hint: 'Both hands open, palms up, wiggle your fingers.',
  },
  why: {
    shape: SHAPES.why,
    place: 'forehead',
    hint: 'Touch your forehead, then pull away into a Y shape.',
  },
  who: { shape: SHAPES.one, place: 'chin', hint: 'Index finger circles in front of your lips.' },
  where: { shape: SHAPES.one, place: 'space', hint: 'Index finger up, shake it side to side.' },
  now: { shape: SHAPES.claw, place: 'space', hint: 'Both bent hands drop down together.' },
  later: { shape: SHAPES.ell, place: 'space', hint: 'L hand, tilt the index finger forward.' },
  tomorrow: {
    shape: SHAPES.fistThumb,
    place: 'cheek',
    hint: 'Thumb touches your cheek, arc it forward.',
  },
  time: { shape: SHAPES.one, place: 'wrist', hint: 'Index finger taps your wrist, like a watch.' },
  finish: {
    shape: SHAPES.open,
    place: 'space',
    hint: 'Open hands, flip them outward, palms down.',
  },
  think: { shape: SHAPES.one, place: 'forehead', hint: 'Index finger touches your forehead.' },
  look: { shape: SHAPES.vee, place: 'eye', hint: 'V fingers start at your eyes, point outward.' },
  listen: { shape: SHAPES.cup, place: 'ear', hint: 'Cupped hand behind your ear.' },
  talk: {
    shape: SHAPES.one,
    place: 'chin',
    hint: 'Index finger at your mouth, move it forward a few times.',
  },
  fine: { shape: SHAPES.open, place: 'chest', hint: 'Open hand, thumb taps your chest.' },
  same: { shape: SHAPES.why, place: 'space', hint: 'Both Y hands, bring them together and tap.' },
  not: { shape: SHAPES.fistThumb, place: 'chin', hint: 'Thumb under your chin, flick it forward.' },
};

export const SIGN_LIST = SIGNS.map((s) => ({
  sign: s,
  label: SIGN_LABEL[s] ?? s,
  ...SIGN_INFO[s],
}));

/** How long the ring and the popup take to glide from one step's spot to the next. */
export const GLIDE_MS = 380;

/** Slows down towards the end, so the glide settles instead of stopping dead. */
export const easeOut = (p: number): number => 1 - Math.pow(1 - Math.min(Math.max(p, 0), 1), 3);

export interface Spot {
  left: number;
  top: number;
}
export interface Frame extends Spot {
  width: number;
  height: number;
}

const mix = (a: number, b: number, p: number) => a + (b - a) * p;

/** A point part-way from where it was to where it is going (`progress` 0..1, eased). */
export function glideSpot(from: Spot | null, to: Spot, progress: number): Spot {
  if (!from || progress >= 1) return to;
  const p = easeOut(progress);
  return { left: mix(from.left, to.left, p), top: mix(from.top, to.top, p) };
}

/** A box part-way from where it was to where it is going. */
export function glideFrame<T extends Frame>(from: Frame | null, to: T, progress: number): T {
  if (!from || progress >= 1) return to;
  const p = easeOut(progress);
  return {
    ...to,
    left: mix(from.left, to.left, p),
    top: mix(from.top, to.top, p),
    width: mix(from.width, to.width, p),
    height: mix(from.height, to.height, p),
  };
}

/**
 * The ONLY module that reads Meet's DOM. Meet's markup is obfuscated and changes without notice, so every
 * lookup here is heuristic, feature-detected, and returns null when unsure; callers must have a fallback.
 * Prefer ARIA labels (which Meet needs for accessibility and which change rarely) over class names.
 */

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export type RectFn = (el: Element) => Rect;

const defaultRect: RectFn = (el) => el.getBoundingClientRect();

const LEAVE = /leave call|leave meeting|end call/i;
const MEDIA_BUTTON = /turn (on|off) (microphone|camera)|(microphone|camera)(,|$)/i;

export interface ControlBar {
  element: Element;
  /** Top edge of the bar in viewport coordinates. */
  top: number;
}

/**
 * Finds the bottom call-control bar: start from a control we can recognise by label (Leave call, mic, camera),
 * then climb to the widest ancestor that still sits in the lower part of the viewport and spans most of its width.
 */
export function locateControlBar(
  doc: Document = document,
  viewport: { width: number; height: number } = { width: innerWidth, height: innerHeight },
  rectOf: RectFn = defaultRect,
): ControlBar | null {
  const anchors = [
    ...doc.querySelectorAll<HTMLElement>('button[aria-label], [role="button"][aria-label]'),
  ].filter((el) => {
    const label = el.getAttribute('aria-label') ?? '';
    return LEAVE.test(label) || MEDIA_BUTTON.test(label);
  });

  const inLowerQuarter = (r: Rect) => r.height > 0 && r.top > viewport.height * 0.7;
  let best: ControlBar | null = null;

  for (const anchor of anchors) {
    if (!inLowerQuarter(rectOf(anchor))) continue;
    let el: Element | null = anchor;
    let candidate: Element = anchor;
    // Climb while the parent is still a bar-like strip at the bottom: wide-ish, short, not the whole page.
    while (el?.parentElement && el.parentElement !== doc.body) {
      const pr = rectOf(el.parentElement);
      if (pr.height > viewport.height * 0.25 || pr.top < viewport.height * 0.7) break;
      el = el.parentElement;
      if (pr.width >= viewport.width * 0.4) candidate = el;
    }
    const r = rectOf(candidate);
    if (!best || r.top < best.top) best = { element: candidate, top: r.top };
  }
  return best;
}

/** Meet call URLs look like /abc-defg-hij (also seen with a trailing path or query). */
export function isMeetCallPath(pathname: string): boolean {
  return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\/|$)/i.test(pathname) || /^\/lookup\//.test(pathname);
}

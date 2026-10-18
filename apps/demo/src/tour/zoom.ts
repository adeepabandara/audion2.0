import type { Placement } from './steps';

/** A zoom of the browser window: scale `s`, then move by (`tx`, `ty`), about the window's own top-left corner. */
export interface Matrix {
  s: number;
  tx: number;
  ty: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const NO_ZOOM: Matrix = { s: 1, tx: 0, ty: 0 };

/** The target never fills more of the screen than this, so there is room for the explanation beside it. */
const MAX_SHARE = 0.6;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Where to put the zoomed window so the target sits where the explanation leaves room for it.
 *
 * - `target` is measured on screen right now, with `current` applied.
 * - `origin` and `size` are the window's own position and size with NO zoom (so the maths does not depend on a zoom
 *   that is still moving).
 * - The result never shows blank page around the window once it is bigger than the screen, and centres it when it is
 *   still smaller.
 */
export function computeZoom(a: {
  target: Box;
  current: Matrix;
  origin: { x: number; y: number };
  size: { w: number; h: number };
  view: { w: number; h: number };
  level: number;
  side: Placement;
}): Matrix {
  const { target, current, origin, size, view, level, side } = a;
  if (level <= 1 || target.width <= 0 || target.height <= 0) return NO_ZOOM;

  // The target in the window's own (un-zoomed) units.
  const lw = target.width / current.s;
  const lh = target.height / current.s;
  const lcx = (target.left + target.width / 2 - origin.x - current.tx) / current.s;
  const lcy = (target.top + target.height / 2 - origin.y - current.ty) / current.s;

  const s = clamp(Math.min(level, (view.w * MAX_SHARE) / lw, (view.h * MAX_SHARE) / lh), 1, level);
  if (s <= 1.02) return NO_ZOOM;

  // Leave room on the side the explanation will sit.
  const fx = side === 'left' ? 0.62 : side === 'right' ? 0.38 : 0.5;
  const fy = side === 'top' ? 0.6 : side === 'bottom' ? 0.4 : 0.5;
  let tx = view.w * fx - origin.x - s * lcx;
  let ty = view.h * fy - origin.y - s * lcy;

  const sw = s * size.w;
  const sh = s * size.h;
  tx = sw >= view.w ? clamp(tx, view.w - origin.x - sw, -origin.x) : (view.w - sw) / 2 - origin.x;
  ty = sh >= view.h ? clamp(ty, view.h - origin.y - sh, -origin.y) : (view.h - sh) / 2 - origin.y;
  return { s, tx, ty };
}

/** The zoom that is applied right now (including part-way through a move), read from the element's own style. */
export function currentMatrix(el: HTMLElement): Matrix {
  const t = getComputedStyle(el).transform;
  const m = /^matrix\(([^)]+)\)$/.exec(t);
  if (!m) return NO_ZOOM;
  const v = m[1]!.split(',').map(Number);
  const [a, , , , e, f] = v;
  return { s: a || 1, tx: e || 0, ty: f || 0 };
}

export function applyZoom(el: HTMLElement, m: Matrix, animate: boolean): void {
  el.style.transition = animate ? 'transform 0.7s cubic-bezier(0.22, 0.8, 0.2, 1)' : 'none';
  el.style.willChange = m.s === 1 ? '' : 'transform';
  el.style.transform =
    m.s === 1 && m.tx === 0 && m.ty === 0 ? '' : `translate(${m.tx}px, ${m.ty}px) scale(${m.s})`;
}

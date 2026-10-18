import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { CoachStep, Placement } from './steps';
import { GLIDE_MS, glideFrame, glideSpot, type Frame, type Spot } from './glide';
import { applyZoom, computeZoom, currentMatrix, NO_ZOOM } from './zoom';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The target's own corner rounding, so the spotlight has the same shape (a circle stays a circle). */
  radius?: string;
}

const PAD = 6;
const GAP = 16;
const POPOVER_W = 300;

/** Where the popover goes: beside the highlighted thing on the wanted side, kept inside the window. */
export function placePopover(
  target: Rect | null,
  placement: Placement,
  size: { w: number; h: number },
  view: { w: number; h: number },
): { left: number; top: number; side: Placement } {
  const clampX = (x: number) => Math.min(Math.max(12, x), view.w - size.w - 12);
  const clampY = (y: number) => Math.min(Math.max(12, y), view.h - size.h - 12);
  if (!target || placement === 'center') {
    return {
      left: (view.w - size.w) / 2,
      top: Math.max(12, (view.h - size.h) / 2),
      side: 'center',
    };
  }
  const cx = target.left + target.width / 2;
  const cy = target.top + target.height / 2;
  const room = {
    top: target.top - PAD - GAP,
    bottom: view.h - (target.top + target.height + PAD + GAP),
    left: target.left - PAD - GAP,
    right: view.w - (target.left + target.width + PAD + GAP),
  };
  // Prefer the wanted side; if the popover does not fit there, take the side with the most room.
  const need = { top: size.h, bottom: size.h, left: size.w, right: size.w };
  let side: Exclude<Placement, 'center'> = placement;
  if (room[side] < need[side]) {
    side = (['bottom', 'top', 'left', 'right'] as const).reduce((a, b) =>
      room[b] - need[b] > room[a] - need[a] ? b : a,
    );
  }
  if (side === 'bottom')
    return { left: clampX(cx - size.w / 2), top: target.top + target.height + PAD + GAP, side };
  if (side === 'top')
    return { left: clampX(cx - size.w / 2), top: target.top - PAD - GAP - size.h, side };
  if (side === 'left')
    return { left: target.left - PAD - GAP - size.w, top: clampY(cy - size.h / 2), side };
  return { left: target.left + target.width + PAD + GAP, top: clampY(cy - size.h / 2), side };
}

export interface CoachProps {
  step: CoachStep;
  index: number;
  total: number;
  /** Finds the highlighted element (the first of several selectors that is there); null when it is not. */
  find(selectors: string | string[]): HTMLElement | null;
  /** The step has just been done (announced to screen readers; the step then moves on by itself). */
  done: boolean;
  /** Something is in the visitor's way (for example the camera is blocked): what it is, and what to do about it. */
  stuck?: { title: string; text: string };
  onNext(): void;
  onSkip(): void;
}

const reducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The rounding of the target's corners as a ring radius: a percentage stays one, pixels grow by the ring's padding. */
function ringRadius(el: HTMLElement): string {
  const r = getComputedStyle(el).borderTopLeftRadius;
  if (r.endsWith('%')) return r;
  const px = parseFloat(r);
  return `${(Number.isFinite(px) ? px : 0) + PAD}px`;
}

/** The nearest ancestor that scrolls, crossing out of a shadow root (Ola's Settings drawer lives in one). */
function scroller(el: HTMLElement): HTMLElement | null {
  let n: Node | null = el.parentNode;
  while (n) {
    if (n instanceof HTMLElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
      n = n.parentNode;
    } else n = n instanceof ShadowRoot ? n.host : null;
  }
  return null;
}

/**
 * If the target is out of sight inside a scrolling panel (Settings: on a short screen "Set up my voice" sits below the
 * bottom of the screen, and the page cannot scroll during the tour), scroll only that panel so the target sits in the
 * middle of the part of the panel that is ON SCREEN. Returns true when it scrolled.
 */
export function revealInScroller(el: HTMLElement, viewHeight = innerHeight): boolean {
  const box = scroller(el);
  if (!box) return false;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  // The part of the panel you can actually see: the panel clipped by the screen.
  const top = Math.max(b.top, 0);
  const bottom = Math.min(b.bottom, viewHeight);
  if (bottom <= top || (r.top >= top && r.bottom <= bottom)) return false;
  // Taller than what can be seen (the voice questions): fine as long as part of it shows; the visitor scrolls it.
  if (r.height >= bottom - top && r.top < bottom && r.bottom > top) return false;
  // Rects are drawn at the window's zoom; scrollTop is not.
  const scale = box.clientHeight ? b.height / box.clientHeight || 1 : 1;
  const before = box.scrollTop;
  box.scrollTop += (r.top - top - (bottom - top - r.height) / 2) / scale;
  return box.scrollTop !== before;
}

/**
 * One guided step: the browser window zooms in on the exact thing to use, everything else is dimmed, a ring in the
 * target's own shape pulses on it, and a small popup says what to do. Clicks go through the lit area (so the visitor can
 * do what is asked) and are blocked elsewhere.
 */
export function Coach({ step, index, total, find, done, stuck, onNext, onSkip }: CoachProps) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [view, setView] = useState({ w: innerWidth, h: innerHeight });
  const [size, setSize] = useState({ w: POPOVER_W, h: 150 });
  const pop = useRef<HTMLDivElement>(null);
  /** Which of the step's selectors currently matches (-1: none). The zoom aims again only when this changes. */
  const lastMatch = useRef<number | undefined>(undefined);
  /** Whether the target was on screen (with a size) in the last frame: it can exist but be hidden, like Ola's pill just after joining. */
  const wasVisible = useRef(false);
  const zoomTimer = useRef<number | undefined>(undefined);
  /**
   * Where the ring and the popup are drawn, and a glide in progress: when the step points at something new they do not
   * jump there, they slide from where they were (and the dimming never blinks, because the same ring stays on screen).
   */
  const shown = useRef<{ hole: Frame | null; pop: Spot | null }>({ hole: null, pop: null });
  const glide = useRef<{ t0: number; from: { hole: Frame | null; pop: Spot | null } } | null>(null);
  /** What the last painted frame showed: the place a glide starts from. */
  const committed = useRef<{ hole: Frame | null; pop: Spot | null }>({ hole: null, pop: null });
  const [, redraw] = useState(0);
  const last = index === total - 1;
  /** Most steps dim everything but the target; the install step leaves the whole page in view and just shows what to click. */
  const spotlight = step.focus !== false;
  /** A step that waits for a click lets it through to the highlighted thing; one that only explains blocks it. */
  const interactive = step.waitFor !== undefined;
  const selectors =
    step.target === undefined ? [] : Array.isArray(step.target) ? step.target : [step.target];
  const matchIndex = () => selectors.findIndex((q) => find(q) !== null);

  /** Zoom the window onto the step's target (or back to normal when there is nothing to zoom on). */
  const runZoom = useRef<() => void>(() => {});
  runZoom.current = () => {
    const zoomer = document.getElementById('zoomer');
    const anchor = document.getElementById('zoom-anchor');
    if (!zoomer || !anchor) return;
    const animate = !reducedMotion();
    const el = step.target ? find(step.target) : null;
    if (el) revealInScroller(el);
    const maximised = document.getElementById('browser')?.classList.contains('is-max');
    if (!el || step.zoom <= 1 || innerWidth < 900 || maximised) {
      applyZoom(zoomer, NO_ZOOM, animate);
      return;
    }
    const box = el.getBoundingClientRect();
    if (box.width === 0) return;
    const a = anchor.getBoundingClientRect();
    applyZoom(
      zoomer,
      computeZoom({
        target: box,
        current: currentMatrix(zoomer),
        origin: { x: a.left, y: a.top },
        size: { w: zoomer.offsetWidth, h: zoomer.offsetHeight },
        view: { w: innerWidth, h: innerHeight },
        level: step.zoom,
        side: step.placement,
      }),
      animate,
    );
  };
  const scheduleZoom = (ms: number) => {
    window.clearTimeout(zoomTimer.current);
    zoomTimer.current = window.setTimeout(() => runZoom.current(), ms);
  };

  // Follow the target every frame: the widget moves, opens and animates, and the window zooms.
  useEffect(() => {
    let raf = 0;
    let lastReveal = 0;
    const tick = () => {
      // A step's control must stay reachable: if a zoom or a redraw leaves it outside the visible part of its panel,
      // bring it back (at most twice a second, so it never fights the visitor's own scrolling for long).
      const now = performance.now();
      if (step.waitFor && step.target && now - lastReveal > 500) {
        const el = find(step.target);
        if (el && revealInScroller(el)) lastReveal = now;
      }
      const el = step.target ? find(step.target) : null;
      // The target appeared, or the step now points at its next control: zoom onto it once, when it has settled. The
      // widget redrawing the same control does not count, or the view would keep moving.
      const match = matchIndex();
      if (match !== lastMatch.current) {
        // (a glide that has only just started, for a new step, is already on its way)
        const fresh = glide.current && performance.now() - glide.current.t0 < 150;
        if (!fresh && (lastMatch.current !== undefined || shown.current.hole))
          glide.current = { t0: performance.now(), from: shown.current };
        lastMatch.current = match;
        scheduleZoom(160);
      }
      if (glide.current) {
        if (performance.now() - glide.current.t0 >= GLIDE_MS) glide.current = null;
        redraw((n) => n + 1);
      }
      const r = el?.getBoundingClientRect();
      // The target has just become visible (the pill appears a moment after the call opens): glide to it and aim the zoom
      // at it now, as it had no size before.
      const visible = !!r && r.width > 0;
      if (visible !== wasVisible.current) {
        wasVisible.current = visible;
        if (visible) {
          const fresh = glide.current && performance.now() - glide.current.t0 < 150;
          if (!fresh && shown.current.pop)
            glide.current = { t0: performance.now(), from: shown.current };
          scheduleZoom(160);
        }
      }
      setRect((old) => {
        if (!r || r.width === 0) return old === null ? old : null;
        const next = {
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
          radius: el ? ringRadius(el) : undefined,
        };
        return old &&
          old.left === next.left &&
          old.top === next.top &&
          old.width === next.width &&
          old.height === next.height &&
          old.radius === next.radius
          ? old
          : next;
      });
      setView((v) => {
        if (v.w === innerWidth && v.h === innerHeight) return v;
        scheduleZoom(160);
        return { w: innerWidth, h: innerHeight };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, find]);

  // A new step: start the glide in the same instant, before anything is painted, from where the last frame left the ring
  // and the popup (without this the popup is first drawn at the new step's place and jumps there).
  useLayoutEffect(() => {
    if (committed.current.hole || committed.current.pop) {
      glide.current = { t0: performance.now(), from: committed.current };
      redraw((n) => n + 1);
    }
  }, [step.id]);
  // After every paint, remember what was shown.
  useLayoutEffect(() => {
    committed.current = shown.current;
  });

  // A new step: aim the zoom at its target (a moment later, once the page has switched to the step's scene).
  useEffect(() => {
    lastMatch.current = undefined;
    wasVisible.current = false;
    scheduleZoom(200);
    return () => window.clearTimeout(zoomTimer.current);
  }, [step.id]);

  // When the tour ends, the window settles back to normal.
  useEffect(
    () => () => {
      const zoomer = document.getElementById('zoomer');
      if (zoomer) applyZoom(zoomer, NO_ZOOM, !reducedMotion());
    },
    [],
  );

  useLayoutEffect(() => {
    const el = pop.current;
    if (el)
      setSize((s) =>
        s.h === el.offsetHeight && s.w === el.offsetWidth
          ? s
          : { w: el.offsetWidth, h: el.offsetHeight },
      );
  });

  // Each step is announced and takes focus, so keyboard and screen reader users follow along.
  useEffect(() => {
    pop.current?.focus({ preventScroll: true });
  }, [step.id]);

  const target = placePopover(rect, step.placement, size, view);
  const wanted = rect
    ? {
        left: rect.left - PAD,
        top: rect.top - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
        borderRadius: rect.radius,
      }
    : null;
  // While a glide is on, draw part-way between the old spot and the new one (never under reduced motion).
  const progress =
    glide.current && !reducedMotion() ? (performance.now() - glide.current.t0) / GLIDE_MS : 1;
  const hole = wanted ? glideFrame(glide.current?.from.hole ?? null, wanted, progress) : null;
  const pos = { ...target, ...glideSpot(glide.current?.from.pop ?? null, target, progress) };
  shown.current = { hole, pop: { left: pos.left, top: pos.top } };
  /** Invisible: it only stops clicks outside the lit area. The dimming is drawn by the ring's own shadow. */
  const block = (style: CSSProperties) => (
    <div className="tour-block" style={style} aria-hidden="true" />
  );

  return (
    <div className="tour-coach">
      {hole ? (
        <>
          {spotlight && (
            <>
              {block({ left: 0, top: 0, width: '100%', height: Math.max(0, hole.top) })}
              {block({ left: 0, top: hole.top + hole.height, width: '100%', bottom: 0 })}
              {block({
                left: 0,
                top: hole.top,
                width: Math.max(0, hole.left),
                height: hole.height,
              })}
              {block({
                left: hole.left + hole.width,
                top: hole.top,
                right: 0,
                height: hole.height,
              })}
              {!interactive &&
                block({ left: hole.left, top: hole.top, width: hole.width, height: hole.height })}
              <div className="tour-ring" style={hole} aria-hidden="true" />
            </>
          )}
          {step.demo === 'click' && (
            <div
              key={`pointer:${step.id}:${matchIndex()}`}
              className="tour-pointer"
              style={{ left: hole.left + hole.width / 2, top: hole.top + hole.height / 2 }}
              aria-hidden="true"
            >
              <span className="tour-pointer__ripple" />
              <svg className="tour-pointer__cursor" width="30" height="30" viewBox="0 0 24 24">
                <path
                  d="M5 3l13 7-5.5 1.7L10 17.5z"
                  fill="#fff"
                  stroke="#0b0f14"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}
        </>
      ) : spotlight ? (
        <div className="tour-dim" aria-hidden="true" />
      ) : null}
      <div
        ref={pop}
        className={`tour-pop tour-pop--${pos.side}`}
        style={{ left: pos.left, top: pos.top, width: Math.min(POPOVER_W, view.w - 24) }}
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onSkip();
        }}
      >
        <ol className="tour-dots" aria-label={`Step ${index + 1} of ${total}`}>
          {Array.from({ length: total }, (_, i) => (
            <li
              key={i}
              className={i < index ? 'is-done' : i === index ? 'is-on' : undefined}
              aria-current={i === index ? 'step' : undefined}
            />
          ))}
        </ol>
        <h2 id="tour-title">{stuck?.title ?? step.title}</h2>
        <p id="tour-text" className={stuck ? 'tour-pop__stuck' : undefined}>
          {stuck?.text ?? step.text}
        </p>
        <p className="au-sr-only" role="status">
          {done ? 'Done.' : ''}
        </p>
        <div className="tour-pop__actions">
          <button type="button" className="tour-link" onClick={onSkip}>
            Skip tour
          </button>
          {last || !interactive ? (
            <button type="button" className="tour-btn" onClick={onNext}>
              {last ? 'Done' : 'Next'}
            </button>
          ) : (
            <button type="button" className="tour-link" onClick={onNext}>
              Skip step
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

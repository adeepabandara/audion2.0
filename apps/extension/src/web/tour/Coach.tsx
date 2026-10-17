import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { CoachStep, Placement } from './steps';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PAD = 8;
const GAP = 16;
const POPOVER_W = 340;

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
  /** Finds the highlighted element; null when it is not there (the popover is then centred). */
  find(selector: string): HTMLElement | null;
  /** A short "Nice!" while the step is moving on by itself. */
  done: boolean;
  onNext(): void;
  onBack(): void;
  onSkip(): void;
}

/**
 * One guided step: the page is dimmed except a window around the highlighted thing, a ring pulses on it, and a
 * popover explains it. Clicks go through the window (so the visitor can do what is asked) and are blocked elsewhere.
 */
export function Coach({ step, index, total, find, done, onNext, onBack, onSkip }: CoachProps) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [view, setView] = useState({ w: innerWidth, h: innerHeight });
  const [size, setSize] = useState({ w: POPOVER_W, h: 220 });
  const pop = useRef<HTMLDivElement>(null);

  // Follow the target every frame: the widget moves, opens and animates.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = step.target ? find(step.target) : null;
      const r = el?.getBoundingClientRect();
      setRect((old) => {
        if (!r || r.width === 0) return old === null ? old : null;
        const next = { left: r.left, top: r.top, width: r.width, height: r.height };
        return old &&
          old.left === next.left &&
          old.top === next.top &&
          old.width === next.width &&
          old.height === next.height
          ? old
          : next;
      });
      setView((v) =>
        v.w === innerWidth && v.h === innerHeight ? v : { w: innerWidth, h: innerHeight },
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, find]);

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

  const pos = placePopover(rect, step.placement, size, view);
  const hole = rect
    ? {
        left: rect.left - PAD,
        top: rect.top - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;
  const block = (style: CSSProperties) => (
    <div className="tour-block" style={style} aria-hidden="true" />
  );

  return (
    <div className="tour-coach">
      {hole ? (
        <>
          {block({ left: 0, top: 0, width: '100%', height: Math.max(0, hole.top) })}
          {block({ left: 0, top: hole.top + hole.height, width: '100%', bottom: 0 })}
          {block({ left: 0, top: hole.top, width: Math.max(0, hole.left), height: hole.height })}
          {block({ left: hole.left + hole.width, top: hole.top, right: 0, height: hole.height })}
          <div className="tour-ring" style={hole} aria-hidden="true" />
        </>
      ) : (
        block({ inset: 0 })
      )}
      <div
        ref={pop}
        className={`tour-pop tour-pop--${pos.side}`}
        style={{ left: pos.left, top: pos.top, width: Math.min(POPOVER_W, view.w - 24) }}
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onSkip();
        }}
      >
        <p className="tour-pop__count">
          Step {index + 1} of {total}
        </p>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>
        {step.hint && <p className="tour-pop__hint">{step.hint}</p>}
        <p className="tour-pop__done" role="status">
          {done ? 'Nice, that worked.' : ''}
        </p>
        <div className="tour-pop__actions">
          <button type="button" className="tour-btn tour-btn--ghost" onClick={onSkip}>
            Skip tour
          </button>
          <span className="tour-spacer" />
          {index > 0 && (
            <button type="button" className="tour-btn tour-btn--ghost" onClick={onBack}>
              Back
            </button>
          )}
          <button type="button" className="tour-btn" onClick={onNext}>
            {step.nextLabel ?? 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

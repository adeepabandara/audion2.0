import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { clampPosition, type Position, type Size } from './position';

interface Options {
  position: Position;
  size: () => Size;
  minBottom: number;
  onMove(p: Position): void;
  onCommit(p: Position): void;
}

const STEP = 16;

/** Pointer drag on the grip, plus arrow keys (Shift = bigger steps) so moving the panel works without a mouse. */
export function useDrag({ position, size, minBottom, onMove, onCommit }: Options) {
  const start = useRef<{ x: number; y: number; pos: Position } | null>(null);
  const latest = useRef(position);
  latest.current = position;
  const viewport = () => ({ width: innerWidth, height: innerHeight });

  const next = useCallback(
    (p: Position) => clampPosition(p, size(), viewport(), minBottom),
    [size, minBottom],
  );

  const onPointerDown = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, pos: latest.current };
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const s = start.current;
      if (!s) return;
      onMove(
        next({ right: s.pos.right - (e.clientX - s.x), bottom: s.pos.bottom - (e.clientY - s.y) }),
      );
    },
    [next, onMove],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (!start.current) return;
      start.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      onCommit(latest.current);
    },
    [onCommit],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const d = (e.shiftKey ? 4 : 1) * STEP;
      // Arrow direction = on-screen direction; position is measured from the right/bottom edges.
      const delta: Record<string, Position> = {
        ArrowLeft: { right: d, bottom: 0 },
        ArrowRight: { right: -d, bottom: 0 },
        ArrowUp: { right: 0, bottom: d },
        ArrowDown: { right: 0, bottom: -d },
      };
      const step = delta[e.key];
      if (!step) return;
      e.preventDefault();
      const p = next({
        right: latest.current.right + step.right,
        bottom: latest.current.bottom + step.bottom,
      });
      onMove(p);
      onCommit(p);
    },
    [next, onMove, onCommit],
  );

  return { onPointerDown, onPointerMove, onPointerUp, onKeyDown };
}

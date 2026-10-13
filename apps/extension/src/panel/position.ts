export interface Position {
  /** Distance from the viewport's right and bottom edges, in px. */
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export const EDGE_MARGIN = 8;
export const BAR_GAP = 12;
export const FALLBACK_BAR_CLEARANCE = 96;

/**
 * Keep the card fully on screen and never over Meet's control bar: `minBottom` is the clearance above the bar.
 */
export function clampPosition(
  pos: Position,
  size: Size,
  viewport: Size,
  minBottom: number,
): Position {
  const maxRight = Math.max(EDGE_MARGIN, viewport.width - size.width - EDGE_MARGIN);
  const maxBottom = Math.max(minBottom, viewport.height - size.height - EDGE_MARGIN);
  return {
    right: Math.min(Math.max(pos.right, EDGE_MARGIN), maxRight),
    bottom: Math.min(Math.max(pos.bottom, minBottom), maxBottom),
  };
}

/** Pixels from the viewport bottom that must stay free: the bar's height plus a gap. */
export function barClearance(barTop: number | null, viewportHeight: number): number {
  return barTop === null
    ? FALLBACK_BAR_CLEARANCE
    : Math.max(viewportHeight - barTop + BAR_GAP, EDGE_MARGIN);
}

export function isPosition(v: unknown): v is Position {
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isFinite((v as Position).right) &&
    Number.isFinite((v as Position).bottom)
  );
}

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface Hand {
  /** 21 MediaPipe hand landmarks, x/y normalised to the frame (0..1). */
  landmarks: Point[];
  handedness: 'Left' | 'Right' | 'Unknown';
}

/** One MediaPipe Pose landmark: x/y normalised to the frame, plus how likely it is to be visible (0..1). */
export interface BodyPoint extends Point {
  visibility: number;
}

export interface LandmarkFrame {
  /** Milliseconds, monotonic (performance.now). */
  t: number;
  hands: Hand[];
  /** 33 MediaPipe Pose landmarks of the one person in view (face, shoulders, arms); null or absent when not found. */
  pose?: BodyPoint[] | null;
}

export const WRIST = 0;
export const MIDDLE_MCP = 9;
const TIPS = [4, 8, 12, 16, 20];
export const TRACKED_POINTS = [WRIST, ...TIPS];

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Hand size proxy: wrist to middle-finger knuckle. Makes speed independent of distance from the camera. */
export function handScale(h: Hand): number {
  const a = h.landmarks[WRIST];
  const b = h.landmarks[MIDDLE_MCP];
  return a && b ? Math.max(dist(a, b), 0.02) : 0.1;
}

/** Pair each hand in `cur` with its counterpart in `prev`: same handedness label, else nearest wrist. */
function pairHands(prev: Hand[], cur: Hand[]): Array<[Hand, Hand]> {
  const pairs: Array<[Hand, Hand]> = [];
  const used = new Set<Hand>();
  for (const c of cur) {
    const cw = c.landmarks[WRIST];
    let best: Hand | undefined;
    let bestD = Infinity;
    for (const p of prev) {
      if (used.has(p)) continue;
      const pw = p.landmarks[WRIST];
      if (!cw || !pw) continue;
      const labelBonus = c.handedness !== 'Unknown' && c.handedness === p.handedness ? 0.5 : 1;
      const d = dist(cw, pw) * labelBonus;
      if (d < bestD) [best, bestD] = [p, d];
    }
    if (best) {
      used.add(best);
      pairs.push([best, c]);
    }
  }
  return pairs;
}

/** Fastest hand's mean landmark displacement, in hand-sizes per second. 0 when it cannot be measured. */
export function frameMotion(prev: LandmarkFrame | null, cur: LandmarkFrame): number {
  if (!prev || prev.hands.length === 0 || cur.hands.length === 0) return 0;
  const dt = (cur.t - prev.t) / 1000;
  if (dt <= 0 || dt > 0.5) return 0; // duplicate or stale frame: do not invent speed
  let fastest = 0;
  for (const [p, c] of pairHands(prev.hands, cur.hands)) {
    let sum = 0;
    let n = 0;
    for (const i of TRACKED_POINTS) {
      const a = p.landmarks[i];
      const b = c.landmarks[i];
      if (a && b) {
        sum += dist(a, b);
        n++;
      }
    }
    if (n) fastest = Math.max(fastest, sum / n / handScale(c) / dt);
  }
  return fastest;
}

/** True when any landmark of any hand is within `margin` of (or beyond) the frame edge. */
export function handsNearEdge(frame: LandmarkFrame, margin = 0.02): boolean {
  return frame.hands.some((h) =>
    h.landmarks.some((p) => p.x < margin || p.x > 1 - margin || p.y < margin || p.y > 1 - margin),
  );
}

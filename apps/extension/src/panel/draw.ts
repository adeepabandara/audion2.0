import type { LandmarkFrame } from '../lib/landmarks';

/** MediaPipe's hand skeleton: pairs of landmark indices. */
const BONES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
] as const;

type Ctx = Pick<
  CanvasRenderingContext2D,
  'clearRect' | 'beginPath' | 'arc' | 'fill' | 'moveTo' | 'lineTo' | 'stroke'
> & {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
};

/**
 * Draw landmark dots (and a faint skeleton), mirrored to match the mirrored preview video. A live camera preview is
 * mirrored like a mirror; a video file is shown as it is, so `mirror` is false there.
 */
export function drawLandmarks(
  ctx: Ctx,
  frame: LandmarkFrame | null,
  w: number,
  h: number,
  color = '#2dd4bf',
  mirror = true,
): number {
  ctx.clearRect(0, 0, w, h);
  if (!frame) return 0;
  let dots = 0;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  for (const hand of frame.hands) {
    const pt = (i: number) => {
      const p = hand.landmarks[i]!;
      return [(mirror ? 1 - p.x : p.x) * w, p.y * h] as const;
    };
    ctx.beginPath();
    for (const [a, b] of BONES) {
      if (!hand.landmarks[a] || !hand.landmarks[b]) continue;
      const [ax, ay] = pt(a);
      const [bx, by] = pt(b);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
    for (let i = 0; i < hand.landmarks.length; i++) {
      const [x, y] = pt(i);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      dots++;
    }
  }
  return dots;
}

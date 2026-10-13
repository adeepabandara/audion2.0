import type { Handshape, Place } from './signs';

const FINGER_X = [20, 28, 36, 44];
const LENGTH = { up: 22, bent: 12, curl: 5 } as const;
const SPREAD = [-14, -5, 5, 14];

/** Simple, original hand-shape glyph: palm, four digits and a thumb. Decorative; the card text carries the meaning. */
export function HandShape({ shape, size = 64 }: { shape: Handshape; size?: number }) {
  const thumb = {
    out: 'M16 50L5 40',
    up: 'M16 50L10 28',
    across: 'M18 48L32 46',
  }[shape.thumb];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="15" y="34" width="34" height="24" rx="9" fill="currentColor" opacity="0.25" />
      <g stroke="currentColor" strokeWidth="6" strokeLinecap="round">
        {shape.fingers.map((d, i) => (
          <line
            key={i}
            x1={FINGER_X[i]}
            y1="36"
            x2={FINGER_X[i]}
            y2={36 - LENGTH[d]}
            transform={shape.spread ? `rotate(${SPREAD[i]} ${FINGER_X[i]} 36)` : undefined}
          />
        ))}
        <path d={thumb} />
      </g>
    </svg>
  );
}

const SPOTS: Record<Place, [number, number]> = {
  forehead: [20, 7],
  eye: [17, 11],
  ear: [12, 12],
  cheek: [25, 15],
  chin: [20, 19],
  chest: [20, 31],
  wrist: [8, 37],
  space: [34, 25],
};

/** Mini head-and-shoulders diagram with a dot where the hand starts. */
export function BodyPlace({ place, size = 40 }: { place: Place; size?: number }) {
  const [x, y] = SPOTS[place];
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="12" r="7" stroke="currentColor" strokeWidth="1.8" opacity="0.7" />
      <path
        d="M5 39c0-9 6-14 15-14s15 5 15 14"
        stroke="currentColor"
        strokeWidth="1.8"
        opacity="0.7"
      />
      <circle cx={x} cy={y} r="3.2" fill="var(--au-highlight)" />
    </svg>
  );
}

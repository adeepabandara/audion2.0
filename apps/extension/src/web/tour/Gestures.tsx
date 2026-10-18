import { BodyPlace, HandShape } from '../../panel/HandPose';
import { SIGN_INFO, SIGN_LABEL } from '../../panel/signs';
import { SIGN_MOTION, type Motion } from './steps';

/** A small arrow showing how the hand moves: away from you, round in a circle, down and forward, side to side, nodding, tapping or wiggling. */
export function MotionArrow({ motion }: { motion: Motion }) {
  const paths: Record<Motion, string[]> = {
    outward: ['M7 27L26 8', 'M16 8h10v10'],
    circle: ['M27 17a10 10 0 1 1-4-8', 'M24 4v6h-6'],
    wiggle: ['M3 18c3-9 7-9 10 0s7 9 10 0 5-6 8-3', 'M27 12l4 3-5 2'],
    down: ['M7 8L26 27', 'M26 18v9h-9'],
    wave: ['M5 17h24', 'M11 11l-6 6 6 6', 'M23 11l6 6-6 6'],
    nod: ['M17 5v24', 'M11 11l6-6 6 6', 'M11 23l6 6 6-6'],
    tap: ['M17 5v15', 'M11 14l6 6 6-6', 'M8 29h18'],
  };
  return (
    <svg width={34} height={34} viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {paths[motion].map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

/**
 * How to make each sign, one row each: the hand shape, where the hand starts on the body, an arrow for the movement, and the
 * movement in words. The hand picture moves the way the hand does (see tour.css), so the sign can be seen, not just read.
 */
export function GestureList({ signs, label }: { signs: string[]; label: string }) {
  return (
    <ol className="tour-gestures" aria-label={label}>
      {signs.map((sign) => {
        const info = SIGN_INFO[sign as keyof typeof SIGN_INFO];
        const motion = SIGN_MOTION[sign] ?? 'outward';
        return (
          <li key={sign}>
            <span className={`tour-gestures__art tour-gestures__art--${motion}`} aria-hidden="true">
              <HandShape shape={info.shape} size={46} />
              <BodyPlace place={info.place} size={34} />
              <MotionArrow motion={motion} />
            </span>
            <span className="tour-gestures__text">
              <strong>{SIGN_LABEL[sign as keyof typeof SIGN_LABEL] ?? sign}</strong>
              {info.hint}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

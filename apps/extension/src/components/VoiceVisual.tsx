import { useMemo } from 'react';

export interface VoiceVisualProps {
  /** The sound's shape from the last sample (0 to 1 per slice); null before anything has been played. */
  peaks: number[] | null;
  /** How far the sample has played, 0 to 1. */
  progress: number;
  /** The line being spoken, shown word by word as it is said. */
  text: string;
  /** Where the voice sits between deep (0) and high (1). */
  pitchPosition: number;
  /** The voice in words: also the text alternative of the picture. */
  portrait: string;
  playing: boolean;
}

const BARS = 56;
const IDLE = Array.from({ length: BARS }, (_, i) => 0.12 + 0.08 * Math.sin(i / 2.5));

/**
 * "See the sound" for someone who cannot hear it: the shape of the sample as it plays, the caption lit word by word in
 * time with the speech (so the pace can be seen), and a bar showing how deep or high the voice is. Everything has a
 * written equivalent in the portrait, so the picture never carries meaning alone.
 */
export function VoiceVisual({
  peaks,
  progress,
  text,
  pitchPosition,
  portrait,
  playing,
}: VoiceVisualProps) {
  const bars = peaks ?? IDLE;
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const said = Math.floor(progress * words.length + 1e-6);
  return (
    <div className="vv">
      <svg
        className="vv__wave"
        viewBox={`0 0 ${BARS * 4} 56`}
        role="img"
        aria-label={`Shape of the sound. ${portrait}`}
        preserveAspectRatio="none"
      >
        {bars.map((v, i) => {
          const h = Math.max(3, v * 52);
          const played = peaks !== null && (i + 1) / BARS <= progress + 1e-6;
          return (
            <rect
              key={i}
              x={i * 4 + 0.5}
              y={28 - h / 2}
              width={3}
              height={h}
              rx={1.5}
              className={played ? 'vv__bar vv__bar--played' : 'vv__bar'}
            />
          );
        })}
      </svg>
      <p className="vv__caption" aria-hidden="true">
        {words.map((w, i) => (
          <span key={i} className={playing && i < said ? 'vv__word vv__word--said' : 'vv__word'}>
            {w}{' '}
          </span>
        ))}
      </p>
      <div className="vv__pitch">
        <span className="vv__pitch-label">Deeper</span>
        <span className="vv__pitch-track" aria-hidden="true">
          <span className="vv__pitch-dot" style={{ left: `${Math.round(pitchPosition * 100)}%` }} />
        </span>
        <span className="vv__pitch-label">Higher</span>
      </div>
    </div>
  );
}

import { Icon } from '@audion/ui';

export interface VoiceNoteProps {
  /** The sound's shape (0 to 1 per slice); null while it is being made. */
  peaks: number[] | null;
  duration: number;
  /** How far it has played, 0 to 1. */
  progress: number;
  playing: boolean;
  busy?: boolean;
  onToggle(): void;
  /** Written description for screen readers, e.g. "Voice note, 12 seconds". */
  label: string;
}

const BARS = 40;
const IDLE = Array.from({ length: BARS }, (_, i) => 0.15 + 0.1 * Math.sin(i / 2));
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** A voice note in the style of a chat message: a play button, the shape of the sound, and how long it is. */
export function VoiceNote({
  peaks,
  duration,
  progress,
  playing,
  busy,
  onToggle,
  label,
}: VoiceNoteProps) {
  // The shape is cut down to the bubble's width.
  const bars = peaks
    ? Array.from({ length: BARS }, (_, i) => peaks[Math.floor((i * peaks.length) / BARS)] ?? 0)
    : IDLE;
  return (
    <div className="vn">
      <button
        type="button"
        className="vn__play"
        onClick={onToggle}
        disabled={busy || !peaks}
        aria-label={playing ? `Stop. ${label}` : `Play. ${label}`}
      >
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <svg
        className="vn__wave"
        viewBox={`0 0 ${BARS * 4} 28`}
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        {bars.map((v, i) => {
          const h = Math.max(3, v * 24);
          const done = peaks !== null && (i + 1) / BARS <= progress + 1e-6;
          return (
            <rect
              key={i}
              x={i * 4 + 0.5}
              y={14 - h / 2}
              width={3}
              height={h}
              rx={1.5}
              className={done ? 'vn__bar vn__bar--on' : 'vn__bar'}
            />
          );
        })}
      </svg>
      <span className="vn__time">{busy ? '…' : peaks ? clock(duration) : ''}</span>
    </div>
  );
}

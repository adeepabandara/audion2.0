import { Icon, Wordmark } from '@audion/ui';

export type CaptionSize = 'small' | 'medium' | 'large';

const FONT: Record<CaptionSize, number> = { small: 16, medium: 20, large: 26 };

export interface CaptionBarProps {
  name: string;
  text: string;
  speaking: boolean;
  size: CaptionSize;
  position: 'bottom' | 'top';
  /** Space to keep free above Meet's control bar when docked at the bottom. */
  clearance: number;
}

/**
 * Local caption bar, styled like Meet's own captions. Only the signer sees it (other participants hear the voice,
 * and Meet captions that). Dark translucent background with white text regardless of theme, like Meet.
 */
export function CaptionBar({ name, text, speaking, size, position, clearance }: CaptionBarProps) {
  // Above the Audion pill (about 56 px tall) as well as Meet's control bar, so the two never overlap.
  const place = position === 'top' ? { top: 16 } : { bottom: clearance + 64 };
  return (
    <div
      className="ap-caption"
      role="status"
      aria-live="polite"
      aria-label="Audion caption"
      style={{ ...place, fontSize: FONT[size] }}
    >
      <Wordmark markOnly size={22} />
      <span className="ap-caption__who">{name}</span>
      <span className="ap-caption__text">{text}</span>
      {speaking && <Icon name="wave" size={20} className="au-pulse" title="Speaking" />}
    </div>
  );
}

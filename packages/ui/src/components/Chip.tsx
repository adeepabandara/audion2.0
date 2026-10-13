import type { ReactNode } from 'react';
import { Icon } from '../icons';

export type ChipState = 'normal' | 'lowConfidence' | 'confirmed';

export interface ChipProps {
  state?: ChipState;
  children: ReactNode;
  onClick?: () => void;
}

const SUFFIX: Record<ChipState, string> = {
  normal: '',
  lowConfidence: ', low confidence, needs confirmation',
  confirmed: ', confirmed',
};

/** A recognised sign. Low confidence = dashed outline + question mark; confirmed = check. Never colour alone. */
export function Chip({ state = 'normal', children, onClick }: ChipProps) {
  const cls = `au-chip au-chip--${state}`;
  const content = (
    <>
      {state === 'lowConfidence' && <Icon name="question" size={16} />}
      {state === 'confirmed' && <Icon name="check" size={16} />}
      <span>{children}</span>
      {SUFFIX[state] && <span className="au-sr-only">{SUFFIX[state]}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {content}
    </button>
  ) : (
    <span className={cls}>{content}</span>
  );
}

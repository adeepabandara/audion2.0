import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

export type BannerTone = 'info' | 'warning' | 'error';

const ICON: Record<BannerTone, IconName> = { info: 'info', warning: 'alert', error: 'alert' };
const LABEL: Record<BannerTone, string> = { info: 'Info', warning: 'Warning', error: 'Error' };

export interface BannerProps {
  tone?: BannerTone;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}

export function Banner({ tone = 'info', title, children, action }: BannerProps) {
  return (
    <div className={`au-banner au-banner--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={ICON[tone]} />
      <div className="au-banner__body">
        <span className="au-sr-only">{LABEL[tone]}: </span>
        {title && <span className="au-banner__title">{title}</span>}
        {children}
      </div>
      {action}
    </div>
  );
}

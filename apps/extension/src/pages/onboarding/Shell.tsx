import { Wordmark } from '@audion/ui';
import type { ReactNode } from 'react';

export function Steps({ active, total = 3 }: { active: number[]; total?: number }) {
  const label =
    active.length > 1
      ? `Steps ${active.join(' and ')} of ${total}`
      : `Step ${active[0]} of ${total}`;
  return (
    <div className="ob__steps" aria-label={label} role="group">
      <span>{label}</span>
      <span aria-hidden="true" style={{ display: 'flex', gap: 6 }}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`ob__dot${active.includes(i + 1) ? ' ob__dot--active' : ''}`} />
        ))}
      </span>
    </div>
  );
}

export function Shell({ children, center }: { children: ReactNode; center?: boolean }) {
  return (
    <div className="ob">
      <main className={`ob__main${center ? ' ob__center' : ''}`}>
        <Wordmark />
        {children}
      </main>
    </div>
  );
}

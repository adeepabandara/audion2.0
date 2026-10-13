import { Icon, type IconName } from '../icons';

export type Status =
  | 'ready'
  | 'seeing'
  | 'signing'
  | 'recognising'
  | 'speaking'
  | 'reconnecting'
  | 'attention';

export const STATUS_META: Record<Status, { icon: IconName; label: string; tone: string }> = {
  ready: { icon: 'check-circle', label: 'Ready', tone: 'ok' },
  seeing: { icon: 'eye', label: 'Seeing you', tone: 'active' },
  signing: { icon: 'hand', label: 'Signing', tone: 'active' },
  recognising: { icon: 'spinner', label: 'Recognising', tone: 'active' },
  speaking: { icon: 'wave', label: 'Speaking', tone: 'active' },
  reconnecting: { icon: 'refresh', label: 'Reconnecting', tone: 'error' },
  attention: { icon: 'alert', label: 'Needs attention', tone: 'warn' },
};

/** Icon + text status. Announced politely when it changes. */
export function StatusPill({ status, label }: { status: Status; label?: string }) {
  const meta = STATUS_META[status];
  return (
    <span className={`au-pill au-pill--${meta.tone}`} role="status" aria-live="polite">
      <Icon name={meta.icon} size={18} />
      <span>{label ?? meta.label}</span>
    </span>
  );
}

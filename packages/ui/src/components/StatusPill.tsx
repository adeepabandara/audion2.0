import { Icon, type IconName } from '../icons';

export type Status =
  | 'off'
  | 'starting'
  | 'ready'
  | 'seeing'
  | 'signing'
  | 'recognising'
  | 'speaking'
  | 'reconnecting'
  | 'attention';

export const STATUS_META: Record<Status, { icon: IconName; label: string; tone: string }> = {
  off: { icon: 'pause', label: 'Off', tone: 'muted' },
  starting: { icon: 'spinner', label: 'Starting camera', tone: 'active' },
  ready: { icon: 'check-circle', label: 'Ready', tone: 'ok' },
  seeing: { icon: 'eye', label: 'Seeing you', tone: 'active' },
  signing: { icon: 'hand', label: 'Signing', tone: 'active' },
  recognising: { icon: 'spinner', label: 'Recognising', tone: 'active' },
  speaking: { icon: 'wave', label: 'Speaking', tone: 'active' },
  reconnecting: { icon: 'refresh', label: 'Reconnecting', tone: 'error' },
  attention: { icon: 'alert', label: 'Needs attention', tone: 'warn' },
};

/** Icon + text status (a red dot while off). Announced politely when it changes. */
export function StatusPill({
  status,
  label,
  iconOnly,
  title,
}: {
  status: Status;
  label?: string;
  /** Tooltip text when the label shown is a shortened form of it. */
  title?: string;
  /** Show just the icon (a red dot while off); the words stay for screen readers and as a tooltip. */
  iconOnly?: boolean;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`au-pill au-pill--${meta.tone}${iconOnly ? ' au-pill--icon' : ''}`}
      role="status"
      aria-live="polite"
      title={title ?? (iconOnly ? (label ?? meta.label) : undefined)}
    >
      {status === 'off' ? (
        <span className="au-pill__dot" aria-hidden="true" />
      ) : (
        <Icon name={meta.icon} size={18} />
      )}
      <span className={iconOnly ? 'au-sr-only' : undefined}>{label ?? meta.label}</span>
    </span>
  );
}

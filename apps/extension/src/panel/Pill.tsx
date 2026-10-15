import { Button, StatusPill, Toggle, Wordmark, type Status } from '@audion/ui';

export interface PillProps {
  status: Status;
  label: string;
  enabled: boolean;
  onToggle(on: boolean): void;
  onExpand(): void;
  style?: React.CSSProperties;
}

/**
 * Collapsed Ola: logo, status, On/Off, expand. Sits above Meet's bar, never over it.
 * While off, the status capsule holds just a red dot (the toggle beside it already says "Off", so the word is not repeated); turning
 * Ola on grows the pill smoothly to show the status ("Starting camera", "Ready", ...). The status stays in the page
 * for screen readers either way.
 */
export function Pill({ status, label, enabled, onToggle, onExpand, style }: PillProps) {
  const off = status === 'off';
  return (
    <div
      className={`ap-pill${off ? ' ap-pill--off' : ''}`}
      role="group"
      aria-label="Ola"
      style={style}
    >
      <Wordmark markOnly size={24} />
      <span className="ap-pill__chip">
        <span className="ap-pill__dot" aria-hidden="true" />
        <span className="ap-pill__status">
          <span className="ap-pill__status-inner">
            <StatusPill status={status} label={label} />
          </span>
        </span>
      </span>
      <Toggle label="Ola" hideLabel checked={enabled} onCheckedChange={onToggle} />
      <Button variant="ghost" icon="chevron-up" iconOnly onClick={onExpand}>
        Expand Ola
      </Button>
    </div>
  );
}

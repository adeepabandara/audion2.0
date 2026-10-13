import { Button, StatusPill, Toggle, Wordmark, type Status } from '@audion/ui';

export interface PillProps {
  status: Status;
  enabled: boolean;
  onToggle(on: boolean): void;
  onExpand(): void;
  style?: React.CSSProperties;
}

/** Collapsed Audion: logo, status (icon + text), On/Off, expand. Sits above Meet's bar, never over it. */
export function Pill({ status, enabled, onToggle, onExpand, style }: PillProps) {
  return (
    <div className="ap-pill" role="group" aria-label="Audion" style={style}>
      <Wordmark markOnly size={24} />
      <StatusPill status={status} />
      <Toggle label="Audion" hideLabel checked={enabled} onCheckedChange={onToggle} />
      <Button variant="ghost" icon="chevron-up" iconOnly onClick={onExpand}>
        Expand Audion
      </Button>
    </div>
  );
}

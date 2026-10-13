import { Button, Icon, StatusPill, Toggle, Wordmark, type Status } from '@audion/ui';
import { forwardRef, type KeyboardEvent, type PointerEvent } from 'react';

const REPORT_URL = import.meta.env.VITE_REPORT_URL as string | undefined;

export interface PanelCardProps {
  status: Status;
  enabled: boolean;
  onToggle(on: boolean): void;
  onCollapse(): void;
  onOpenSettings(): void;
  onOpenSigns(): void;
  style?: React.CSSProperties;
  dragHandlers: {
    onPointerDown(e: PointerEvent<HTMLButtonElement>): void;
    onPointerMove(e: PointerEvent<HTMLButtonElement>): void;
    onPointerUp(e: PointerEvent<HTMLButtonElement>): void;
    onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
  };
}

/** Expanded panel (~320px). Camera, chips and sentence are wired up in M5/M6; until then they show empty states. */
export const PanelCard = forwardRef<HTMLElement, PanelCardProps>(function PanelCard(
  { status, enabled, onToggle, onCollapse, onOpenSettings, onOpenSigns, style, dragHandlers },
  ref,
) {
  return (
    <section ref={ref} className="ap-card" aria-label="Audion panel" style={style}>
      <header className="ap-card__head">
        <button
          type="button"
          className="ap-grip"
          aria-label="Move Audion panel. Drag, or use the arrow keys."
          {...dragHandlers}
        >
          <Icon name="grip" size={18} />
        </button>
        <Wordmark size={24} />
        <span className="ap-spacer" />
        <Toggle label="Audion" hideLabel checked={enabled} onCheckedChange={onToggle} />
        <Button variant="ghost" icon="chevron-down" iconOnly onClick={onCollapse}>
          Collapse Audion
        </Button>
      </header>

      <div className="ap-preview" aria-label="Camera preview">
        <Icon name="camera" size={28} />
        <span>{enabled ? 'Camera preview' : 'Camera is off'}</span>
      </div>

      <StatusPill status={status} />

      <div className="ap-chips" aria-label="Recognised signs" aria-live="polite">
        <span className="ap-note">Signs you make will appear here.</span>
      </div>

      <div className="ap-sentence" aria-label="Sentence" aria-live="polite">
        <span className="ap-note">Your sentence will appear here.</span>
      </div>

      <div className="ap-actions">
        <Button icon="wave" disabled={!enabled}>
          Speak
        </Button>
        <Button variant="secondary" disabled={!enabled}>
          Cancel
        </Button>
      </div>

      <footer className="ap-foot">
        <Button variant="ghost" icon="gear" iconOnly onClick={onOpenSettings}>
          Settings
        </Button>
        <Button variant="ghost" icon="hand" iconOnly onClick={onOpenSigns}>
          Supported signs
        </Button>
        <span className="ap-spacer" />
        {REPORT_URL && (
          <a className="ap-link" href={REPORT_URL} target="_blank" rel="noreferrer">
            Report a problem
          </a>
        )}
      </footer>
    </section>
  );
});

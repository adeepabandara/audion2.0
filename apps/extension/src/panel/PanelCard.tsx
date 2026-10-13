import {
  Banner,
  Button,
  Chip,
  Icon,
  KeyHint,
  Popover,
  PopoverActions,
  StatusPill,
  Toggle,
  Wordmark,
} from '@audion/ui';
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { send } from '../lib/messages';
import { SIGN_LABEL } from './signs';
import { drawLandmarks } from './draw';
import { pendingChip, type MachineState, type Problem, type View } from './machine';
import type { AudionSession } from './session';

const REPORT_URL = import.meta.env.VITE_REPORT_URL as string | undefined;

const BANNER_TONE: Record<Problem, 'warning' | 'error'> = {
  cameraBlocked: 'error',
  offline: 'error',
  notRecognised: 'warning',
  lowLight: 'warning',
  handsOut: 'warning',
  voiceUnavailable: 'warning',
};

function Guide() {
  return (
    <svg
      className="ap-guide"
      viewBox="0 0 400 300"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeDasharray="8 8"
      aria-hidden="true"
    >
      <circle cx="200" cy="95" r="42" />
      <path d="M95 300c0-62 46-100 105-100s105 38 105 100" />
      <circle cx="105" cy="210" r="26" />
      <circle cx="295" cy="210" r="26" />
    </svg>
  );
}

function Preview({
  session,
  on,
  showGuide,
}: {
  session: AudionSession;
  on: boolean;
  showGuide: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    session.attachPreview(video.current);
    return () => session.attachPreview(null);
  }, [session]);

  useEffect(
    () =>
      session.onFrame((frame) => {
        const c = canvas.current;
        const ctx = c?.getContext('2d');
        if (c && ctx) drawLandmarks(ctx, frame, c.width, c.height);
      }),
    [session],
  );

  return (
    <div className="ap-preview" aria-label="Camera preview">
      <video ref={video} className="ap-preview__video" autoPlay muted playsInline hidden={!on} />
      <canvas
        ref={canvas}
        className="ap-preview__dots"
        width={320}
        height={240}
        hidden={!on}
        aria-hidden="true"
      />
      {on && showGuide && <Guide />}
      {!on && (
        <>
          <Icon name="camera" size={28} />
          <span>Camera is off</span>
        </>
      )}
    </div>
  );
}

const CAMERA_TEXT = {
  blocked: 'Chrome is blocking the camera on this site. Audion needs it to see your signs.',
  busy: 'Your camera is in use by another app. Close that app, then try again.',
  missing: 'No camera was found. Plug one in or check your system settings, then try again.',
  unknown: 'Couldn’t start hand tracking. Reload this Meet tab, then try again.',
} as const;

function CameraProblem({
  problem,
  onRetry,
}: {
  problem: keyof typeof CAMERA_TEXT;
  onRetry(): void;
}) {
  const [steps, setSteps] = useState(false);
  return (
    <div className="ap-stack">
      <Banner tone="error" title="Camera blocked. ">
        {CAMERA_TEXT[problem]}
      </Banner>
      {steps && (
        <ol className="ap-steps">
          <li>Click the camera icon at the right end of Chrome’s address bar.</li>
          <li>Choose “Always allow” for this site, then close the box.</li>
          <li>Press Try again.</li>
        </ol>
      )}
      <div className="ap-actions">
        {problem === 'blocked' && (
          <Button variant="secondary" onClick={() => setSteps(true)} aria-expanded={steps}>
            Fix permissions
          </Button>
        )}
        {problem === 'blocked' && steps && (
          <Button variant="ghost" onClick={() => void send({ type: 'ui/openCameraSettings' })}>
            Open Chrome camera settings
          </Button>
        )}
        <Button onClick={onRetry}>Try again</Button>
      </div>
    </div>
  );
}

export interface PanelCardProps {
  session: AudionSession;
  state: MachineState;
  view: View;
  onToggle(on: boolean): void;
  voiceMuted: boolean;
  onVoiceMutedChange(muted: boolean): void;
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

/** Expanded panel (~320px). Composing and speaking arrive in M6; the sentence box stays empty until then. */
export const PanelCard = forwardRef<HTMLElement, PanelCardProps>(function PanelCard(
  {
    session,
    state,
    view,
    onToggle,
    voiceMuted,
    onVoiceMutedChange,
    onCollapse,
    onOpenSettings,
    onOpenSigns,
    style,
    dragHandlers,
  },
  ref,
) {
  const pending = pendingChip(state);
  const cameraBlocked = state.problems.includes('cameraBlocked');
  const idle = !state.composing && !state.speaking;
  const canSpeak =
    state.on &&
    idle &&
    (state.sentence !== null || (state.chips.length > 0 && !pending && state.inFlight === 0));
  const canCancel =
    state.on && !state.speaking && (state.chips.length > 0 || state.sentence !== null);
  const label = (sign: string) => SIGN_LABEL[sign as keyof typeof SIGN_LABEL] ?? sign;

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
        <Toggle label="Audion" hideLabel checked={state.on} onCheckedChange={onToggle} />
        <Button variant="ghost" icon="chevron-down" iconOnly onClick={onCollapse}>
          Collapse Audion
        </Button>
      </header>

      {cameraBlocked ? (
        <CameraProblem
          problem={state.cameraProblem ?? 'unknown'}
          onRetry={() => void session.turnOn()}
        />
      ) : (
        <>
          <Preview
            session={session}
            on={state.on && !state.starting}
            showGuide={view.problem === 'handsOut'}
          />
          <StatusPill status={view.status} label={view.label} />
          {view.problem && (
            <Banner tone={BANNER_TONE[view.problem]}>
              {view.problem === 'notRecognised'
                ? 'Couldn’t recognize that, try again slowly.'
                : view.problem === 'lowLight'
                  ? 'Move to a brighter spot.'
                  : view.hint}
            </Banner>
          )}
        </>
      )}

      <Popover
        open={!!pending}
        onOpenChange={(open) => !open && session.confirmRetry()}
        dismissOnOutside={false}
        title={pending ? `Did you mean “${label(pending.sign)}”?` : ''}
        anchor={
          <div className="ap-chips" role="group" aria-label="Recognised signs" aria-live="polite">
            {state.chips.length === 0 ? (
              <span className="ap-note">Signs you make will appear here.</span>
            ) : (
              state.chips.map((c) => (
                <Chip key={c.id} state={c.state === 'normal' ? 'confirmed' : c.state}>
                  {label(c.sign)}
                </Chip>
              ))
            )}
          </div>
        }
      >
        <PopoverActions>
          <Button onClick={session.confirmYes}>
            Yes <KeyHint>Enter</KeyHint>
          </Button>
          <Button variant="secondary" onClick={session.confirmRetry}>
            Try again <KeyHint>Esc</KeyHint>
          </Button>
        </PopoverActions>
      </Popover>

      <div className="ap-sentence" aria-label="Sentence" aria-live="polite">
        {state.sentence !== null ? (
          state.sentence
        ) : state.composing ? (
          <span className="ap-note">Writing your sentence…</span>
        ) : (
          <span className="ap-note">Your sentence will appear here.</span>
        )}
      </div>

      <div className="ap-actions">
        <Button icon="wave" disabled={!canSpeak} onClick={() => void session.speakNow()}>
          Speak
        </Button>
        <Button variant="secondary" disabled={!canCancel} onClick={session.clear}>
          Cancel
        </Button>
      </div>

      <Toggle
        label="Speak into the call"
        checked={!voiceMuted}
        onCheckedChange={(on) => onVoiceMutedChange(!on)}
      />
      {state.on && state.micMuted && !voiceMuted && (
        <Banner tone="info">
          Your Meet microphone is muted, so others can’t hear Audion. Unmute it in Meet.
        </Banner>
      )}
      {voiceMuted && state.on && (
        <Banner tone="info">Audion’s voice is off. Sentences appear as captions only.</Banner>
      )}
      {state.notice && <Banner tone="info">{state.notice}</Banner>}

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

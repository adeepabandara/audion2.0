import {
  Banner,
  BrainSparkle,
  Button,
  Chip,
  Icon,
  KeyHint,
  Popover,
  PopoverActions,
  StatusPill,
  Toggle,
  Tooltip,
  Wordmark,
} from '@audion/ui';
import {
  forwardRef,
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { LANGUAGES, type LanguageCode } from '@audion/shared';
import { send } from '../lib/messages';
import { SIGN_LABEL } from './signs';
import { drawLandmarks } from './draw';
import { pendingChip, type MachineState, type Problem, type View } from './machine';
import type { AudionSession } from './session';

const REPORT_URL = import.meta.env.VITE_REPORT_URL as string | undefined;

/** Shorter wording for the longest statuses, so the header's status pill can show a word next to its icon. */
const SHORT_STATUS: Record<string, string> = {
  'Starting camera': 'Starting',
  'Writing your sentence': 'Writing',
  'Sentence ready': 'Ready',
  'Poor lighting': 'Low light',
  'Voice not connected': 'No voice',
  'Camera blocked': 'No camera',
  'Needs attention': 'Attention',
  'Reconnecting…': 'Offline',
};

const BANNER_TONE: Record<Problem, 'warning' | 'error'> = {
  cameraBlocked: 'error',
  offline: 'error',
  notRecognised: 'warning',
  lowLight: 'warning',
  handsOut: 'warning',
  voiceUnavailable: 'warning',
};

/** Text that arrives word by word (each word fades up a little after the one before). Plain text for assistive tech. */
function RevealWords({ text }: { text: string }) {
  const words = text.split(/\s+/).filter(Boolean);
  // Never slower than about a second in all, however long the summary is.
  const step = Math.min(45, 1000 / Math.max(words.length, 1));
  return (
    <span className="ap-reveal" style={{ '--ap-step': `${step}ms` } as CSSProperties}>
      {words.map((word, i) => (
        <Fragment key={i}>
          <span className="ap-word" style={{ '--ap-i': i } as CSSProperties}>
            {word}
          </span>
          {/* the space sits outside the animated word, where inline-block would collapse it */}{' '}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * The meeting-context indicator: only an icon (a brain with sparkles) sitting on the top-right corner of the sentence
 * card. Hovering or focusing it opens a panel beside the card: "Analysing the meeting…" as an animated gradient title
 * and, below it, what has been picked up so far, which appears word by word.
 */
function MeetingContextBadge({ state, demo }: { state: MachineState; demo: boolean }) {
  const { state: ctx, summary, updating } = state.context;
  const gradient = useId().replace(/:/g, '');
  // The panel opens beside the whole card, not over it: its distance from the badge is measured when the pointer or
  // the keyboard arrives.
  const [clear, setClear] = useState(8);
  const measure = (el: HTMLElement) => {
    const card = el.closest('.ap-card');
    if (card)
      setClear(
        Math.round(el.getBoundingClientRect().left - card.getBoundingClientRect().left) + 10,
      );
  };
  const following = state.on && ctx === 'following';
  const waiting = state.on && ctx === 'waiting';
  const live = following || waiting;
  const title =
    !state.on || ctx === 'off'
      ? 'Meeting context off'
      : waiting
        ? 'Listening for the meeting…'
        : 'Analysing the meeting…';
  const detail =
    !state.on || ctx === 'off'
      ? 'Turn it on in Settings and Ola will follow the meeting’s captions to word your sentences better.'
      : waiting
        ? demo
          ? 'Waiting for the meeting’s captions.'
          : 'Waiting for captions. Turn on captions (CC) in Meet so Ola can follow the conversation.'
        : (summary ?? 'Following the captions. The first summary appears in a few seconds.');
  return (
    <Tooltip
      side="left"
      align="start"
      sideOffset={clear}
      className="ap-context-tip"
      content={
        <>
          <strong
            className={`ap-context-tip__title ap-gemini${live ? ' ap-gemini--live' : ' ap-gemini--off'}${
              following && updating ? ' ap-gemini--busy' : ''
            }`}
          >
            {title}
          </strong>
          {/* keyed by the text, so the words play again whenever the summary changes */}
          <RevealWords key={detail} text={detail} />
        </>
      }
    >
      <button
        type="button"
        className={`ap-ctx${live ? ' ap-ctx--live' : ''}${following && updating ? ' ap-ctx--busy' : ''}`}
        aria-label={`Meeting context: ${title}`}
        onPointerEnter={(e) => measure(e.currentTarget)}
        onPointerMove={(e) => measure(e.currentTarget)}
        onFocus={(e) => measure(e.currentTarget)}
      >
        {/* The gradient the icon is filled with: the same blue to violet to rose as the title. */}
        <svg width="0" height="0" aria-hidden="true" className="ap-ctx__defs">
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--au-gemini-1)' }} />
              <stop offset="0.55" style={{ stopColor: 'var(--au-gemini-2)' }} />
              <stop offset="1" style={{ stopColor: 'var(--au-gemini-3)' }} />
            </linearGradient>
          </defs>
        </svg>
        <BrainSparkle
          size={22}
          className="ap-ctx__icon"
          style={live ? { fill: `url("#${gradient}")` } : undefined}
        />
      </button>
    </Tooltip>
  );
}

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
  children,
}: {
  session: AudionSession;
  on: boolean;
  showGuide: boolean;
  /** A message about the picture ("Needs more light."), drawn over its bottom edge so it adds no row. */
  children?: React.ReactNode;
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
        // The web demo adds .ap-unmirrored while a video file stands in for the camera (see panel.css).
        if (c && ctx)
          drawLandmarks(ctx, frame, c.width, c.height, undefined, !c.closest('.ap-unmirrored'));
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
      {children}
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
  blocked: 'Allow it for this site.',
  busy: 'Another app is using it.',
  missing: 'No camera found.',
  unknown: 'Tracking failed. Reload the tab.',
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
  /** Live translation: the language Ola's sentences are translated into ('en' = no translation). */
  language?: LanguageCode;
  onLanguageChange?(language: LanguageCode): void;
  onCollapse(): void;
  onOpenSettings(): void;
  onOpenSigns(): void;
  /** The public web demo: there is no Meet call, so no call-audio messages, and the voice just plays aloud. */
  demo?: boolean;
  /** Show Speak and Cancel: only while the sentence waits for the signer ("Confirm first"). */
  showActions?: boolean;
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
    demo = false,
    showActions = false,
    state,
    view,
    onToggle,
    voiceMuted,
    onVoiceMutedChange,
    language = 'en',
    onLanguageChange,
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

  // The signs are one row that never grows: when there are more than fit, move to the end so the newest stay in view.
  const chipsRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = chipsRow.current;
    if (row) row.scrollLeft = row.scrollWidth;
  }, [state.chips.length]);

  // One message at a time, drawn on the camera picture so it never adds a row (the card has a fixed size and does
  // not scroll). The most important wins: a problem with the picture, then a notice, then the call-audio messages.
  const message: {
    tone: 'info' | 'warning' | 'error';
    text: React.ReactNode;
    /** A reassurance, not a problem: a plain note, not a banner (so the card has one status region). */
    plain?: boolean;
  } | null = view.problem
    ? {
        tone: BANNER_TONE[view.problem],
        text:
          view.problem === 'notRecognised'
            ? 'Not recognised. Sign again.'
            : view.problem === 'lowLight'
              ? 'Needs more light.'
              : view.hint,
      }
    : state.notice
      ? { tone: 'info', text: state.notice }
      : !demo && state.on && !voiceMuted && state.delivered === false
        ? {
            tone: 'warning',
            text: 'Call can’t hear Ola. Toggle your mic.',
          }
        : !demo &&
            state.on &&
            !voiceMuted &&
            state.callAudio === 'none' &&
            !state.problems.includes('voiceUnavailable')
          ? {
              tone: 'warning',
              text: 'Not in the call yet. Unmute Meet.',
            }
          : !demo && state.on && state.micMuted && !voiceMuted
            ? {
                tone: 'info',
                text: 'Mic muted: others can’t hear Ola.',
              }
            : !demo &&
                state.on &&
                !voiceMuted &&
                state.callAudio === 'connected' &&
                !state.micMuted &&
                state.delivered !== false
              ? {
                  tone: 'info',
                  plain: true,
                  text: `Call audio connected${state.delivered === true ? ' · sent' : ''}.`,
                }
              : null;

  return (
    <section ref={ref} className="ap-card" aria-label="Ola panel" style={style}>
      <header className="ap-card__head">
        <button
          type="button"
          className="ap-grip"
          aria-label="Move Ola panel. Drag, or use the arrow keys."
          {...dragHandlers}
        >
          <Icon name="grip" size={18} />
        </button>
        <Wordmark markOnly size={24} />
        <span className="ap-spacer" />
        <StatusPill
          status={view.status}
          label={SHORT_STATUS[view.label] ?? view.label}
          title={view.label}
        />
        <Toggle label="Ola" hideLabel checked={state.on} onCheckedChange={onToggle} />
        <Button variant="ghost" icon="chevron-down" iconOnly onClick={onCollapse}>
          Collapse Ola
        </Button>
      </header>

      <div className="ap-card__body">
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
            >
              {message &&
                (message.plain ? (
                  <p className="ap-preview__note ap-callaudio">
                    <Icon name="check" size={14} /> {message.text}
                  </p>
                ) : (
                  <Banner tone={message.tone}>{message.text}</Banner>
                ))}
            </Preview>

            <Popover
              open={!!pending}
              onOpenChange={(open) => !open && session.confirmRetry()}
              dismissOnOutside={false}
              title={pending ? `Did you mean “${label(pending.sign)}”?` : ''}
              anchor={
                <div
                  ref={chipsRow}
                  className="ap-chips"
                  role="group"
                  aria-label="Recognised signs"
                  aria-live="polite"
                >
                  {state.chips.length === 0 ? (
                    <span className="ap-note">Signs you make will appear here.</span>
                  ) : (
                    state.chips.map((c) => (
                      <Chip key={c.id} state={c.state === 'normal' ? 'confirmed' : c.state}>
                        {label(c.sign)}
                        {c.checking && <span className="ap-chip-note"> · checking</span>}
                        {c.corrected && (
                          <span className="ap-chip-note"> · was {label(c.corrected.was)}</span>
                        )}
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

            {/* The badge sits on the top-right corner of the sentence card. */}
            <div className="ap-sentence-wrap">
              <MeetingContextBadge state={state} demo={demo} />
              {/* Three lines at most, cut with an ellipsis; the whole sentence is the tooltip and the caption bar. */}
              <div
                className="ap-sentence"
                aria-label="Sentence"
                aria-live="polite"
                title={state.sentence ?? undefined}
              >
                <span className="ap-sentence__text">
                  {state.sentence !== null ? (
                    state.sentence
                  ) : state.composing ? (
                    <span className="ap-note">Writing your sentence…</span>
                  ) : state.on && state.chips.length > 0 && state.inFlight === 0 ? (
                    <span className="ap-note">
                      Keep signing to build a sentence. Ola speaks after a pause
                      {showActions ? ', or press Speak' : ''}.
                    </span>
                  ) : (
                    <span className="ap-note">Your sentence will appear here.</span>
                  )}
                </span>
              </div>
            </div>

            {/* Speak and Cancel only matter when the sentence waits for you ("Confirm first" in Settings). */}
            {showActions && (
              <div className="ap-actions">
                <Button icon="wave" disabled={!canSpeak} onClick={() => void session.speakNow()}>
                  Speak
                </Button>
                <Button variant="secondary" disabled={!canCancel} onClick={session.clear}>
                  Cancel
                </Button>
              </div>
            )}

            <div className="ap-voice-row">
              <Toggle
                label={demo ? 'Speak aloud' : 'Speak into the call'}
                checked={!voiceMuted}
                onCheckedChange={(on) => onVoiceMutedChange(!on)}
              />
              {onLanguageChange && (
                <label className="ap-lang">
                  <Icon name="globe" size={16} />
                  <span className="au-sr-only">Translate Ola’s sentences into</span>
                  <select
                    value={language}
                    onChange={(e) => onLanguageChange(e.target.value as LanguageCode)}
                    title={language === 'en' ? 'Translate to…' : `Translating to ${language}`}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.code === 'en' ? 'No translation' : l.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </>
        )}
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

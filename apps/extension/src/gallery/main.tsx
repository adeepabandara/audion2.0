// The Ola UI gallery: every component and screen, rendered from the real code, with a note on when each one appears.
// It is a developer/design aid (built to ui-components/index.html), not part of the extension or the web demo.
import {
  Banner,
  Button,
  Chip,
  ICON_NAMES,
  Icon,
  KeyHint,
  Segmented,
  Slider,
  STATUS_META,
  StatusPill,
  Tabs,
  ThemeRoot,
  Toggle,
  Tooltip,
  VoiceCard,
  Wordmark,
  type Status,
  type Theme,
} from '@audion/ui';
import ui from '@audion/ui/styles.css?inline';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { LandmarkFrame } from '../lib/landmarks';
import onboardingCss from '../pages/onboarding/onboarding.css?inline';
import { Done } from '../pages/onboarding/Done';
import { Permissions } from '../pages/onboarding/Permissions';
import { Setup } from '../pages/onboarding/Setup';
import { Welcome } from '../pages/onboarding/Welcome';
import { CaptionBar } from '../panel/CaptionBar';
import { initialMachine, viewOf, type ChipItem, type MachineState } from '../panel/machine';
import { PanelCard } from '../panel/PanelCard';
import panelCss from '../panel/panel.css?inline';
import { Pill } from '../panel/Pill';
import type { AudionSession } from '../panel/session';
import { SettingsDrawer } from '../panel/SettingsDrawer';
import { SIGN_LIST } from '../panel/signs';
import { SignsGrid } from '../panel/SignsGrid';
import { SummaryCard } from '../panel/SummaryCard';
import galleryCss from './gallery.css?inline';

// The panel talks to the extension's service worker with chrome.runtime.sendMessage; here nothing is behind it.
(window as unknown as { chrome: unknown }).chrome = {
  runtime: { id: 'gallery', sendMessage: async () => ({ ok: true, entries: [] }) },
};

// The first-run screens (set-up, calibration) ask for the camera. A gallery must never prompt for it, so it gets a
// drawn stand-in picture: those screens then show their normal "camera on" look.
if (navigator.mediaDevices) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = '#10151c';
    g.fillRect(0, 0, 640, 480);
  }
  navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(5);
}

const style = document.createElement('style');
style.textContent = ui + panelCss + onboardingCss + galleryCss;
document.head.append(style);

// ---- a drawn hand, so the camera preview shows what the hand dots look like ----
const FINGER_X = [0.39, 0.46, 0.52, 0.58, 0.64];
function openHand(): LandmarkFrame {
  const pts = [{ x: 0.52, y: 0.88, z: 0 }]; // wrist
  // thumb (4 points), then index, middle, ring, little finger (4 points each)
  for (let i = 1; i <= 4; i++) pts.push({ x: 0.52 - i * 0.045, y: 0.82 - i * 0.07, z: 0 });
  for (let f = 1; f <= 4; f++) {
    const lean = (f - 2.5) * 0.012;
    for (let i = 0; i < 4; i++)
      pts.push({ x: FINGER_X[f]! + lean * i, y: 0.62 - i * 0.09 + Math.abs(f - 2.5) * 0.02, z: 0 });
  }
  return { t: 0, hands: [{ landmarks: pts, handedness: 'Right' }] };
}

function stubSession(withHand: boolean): AudionSession {
  const frame = openHand();
  return {
    attachPreview() {},
    onFrame(cb: (f: LandmarkFrame) => void) {
      if (withHand) setTimeout(() => cb(frame), 0);
      return () => {};
    },
    turnOn: async () => {},
    confirmRetry() {},
    confirmYes() {},
    speakNow: async () => {},
    clear() {},
  } as unknown as AudionSession;
}

const noop = () => {};
const drag = {
  onPointerDown: noop,
  onPointerMove: noop,
  onPointerUp: noop,
  onKeyDown: noop,
};

const chip = (id: number, sign: ChipItem['sign'], extra: Partial<ChipItem> = {}): ChipItem => ({
  id,
  sign,
  state: 'normal',
  confidence: 0.9,
  source: 'device',
  ...extra,
});

const base = initialMachine();
const on = (o: Partial<MachineState> = {}): MachineState => ({ ...base, on: true, ...o });

interface CardCase {
  title: string;
  when: string;
  state: MachineState;
  demo?: boolean;
  showActions?: boolean;
  voiceMuted?: boolean;
}

const SENTENCE = 'Hello, please wait.';
const TWO = [chip(1, 'hello'), chip(2, 'please')];

const FLOW: CardCase[] = [
  { title: 'Off', when: 'Ola is installed but switched off. The camera is not used.', state: base },
  {
    title: 'Starting camera',
    when: 'The toggle was switched on. Ola asks the browser for the camera and loads hand tracking.',
    state: on({ starting: true }),
  },
  {
    title: 'Ready',
    when: 'The camera works. Ola is waiting for hands to appear.',
    state: on(),
  },
  {
    title: 'Seeing you',
    when: 'Hands are in the picture (the dots follow them). Nothing has been signed yet.',
    state: on({ handsVisible: true }),
  },
  {
    title: 'Signing',
    when: 'The hands are moving like a sign. Ola is cutting a short clip of just that sign.',
    state: on({ handsVisible: true, signing: true }),
  },
  {
    title: 'Recognising',
    when: 'The sign has ended. The on-device model is naming it (it takes a fraction of a second).',
    state: on({ handsVisible: true, inFlight: 1 }),
  },
  {
    title: 'Signs recognised',
    when: 'Each recognised sign becomes a chip in the row. They collect while the signer keeps signing.',
    state: on({ chips: TWO }),
  },
  {
    title: 'Writing your sentence',
    when: 'The signer paused. Gemma (or Gemini) is turning the signs into one sentence.',
    state: on({ chips: TWO, composing: true, composingIds: [1, 2] }),
  },
  {
    title: 'Sentence ready',
    when: 'The sentence is written. In auto mode it is spoken at once; in Confirm first it waits for Speak.',
    state: on({ chips: TWO, sentence: SENTENCE, sentenceIds: [1, 2] }),
  },
  {
    title: 'Speaking',
    when: 'Google Text-to-Speech is saying the sentence aloud (and, in Meet, into the call).',
    state: on({
      speaking: true,
      sentence: SENTENCE,
      sentenceIds: [1, 2],
      caption: SENTENCE,
      chips: TWO,
    }),
  },
  {
    title: 'Confirm first: Speak and Cancel',
    when: 'The signer chose "Confirm first" in Settings, so the buttons appear and nothing is spoken until Speak is pressed.',
    state: on({ chips: TWO, sentence: SENTENCE, sentenceIds: [1, 2] }),
    showActions: true,
  },
  {
    title: 'Voice off',
    when: 'The signer muted Ola’s voice. Sentences still appear as captions.',
    state: on({ chips: TWO, sentence: SENTENCE, sentenceIds: [1, 2] }),
    voiceMuted: true,
  },
];

const PROBLEMS: CardCase[] = [
  {
    title: 'Camera blocked',
    when: 'The browser refused the camera. A button takes the signer to the setting. Nothing else works until it is fixed.',
    state: on({ problems: ['cameraBlocked'], cameraProblem: 'blocked' }),
  },
  {
    title: 'Poor lighting',
    when: 'The picture is too dark for hand tracking. A message is drawn over the camera picture.',
    state: on({ problems: ['lowLight'] }),
  },
  {
    title: 'Hands out of frame',
    when: 'Hands were seen, then left the picture mid-sign.',
    state: on({ problems: ['handsOut'], handsVisible: true }),
  },
  {
    title: 'Couldn’t recognise that',
    when: 'The model was not sure enough (below its confidence limit), so it asks the signer to sign again instead of guessing.',
    state: on({ problems: ['notRecognised'] }),
  },
  {
    title: 'Reconnecting',
    when: 'The network dropped. Signs are kept and sent when it returns.',
    state: on({ problems: ['offline'], chips: TWO }),
  },
  {
    title: 'Voice not connected (Meet only)',
    when: 'In Google Meet, the call has no microphone stream for Ola’s voice (Meet is muted or the tab needs a reload).',
    state: on({ problems: ['voiceUnavailable'], callAudio: 'none', micMuted: true }),
  },
  {
    title: 'Notice',
    when: 'A short, non-blocking message, for example when a chat post was skipped.',
    state: on({ notice: 'Chat post skipped: the Meet chat is closed.' }),
  },
];

const CONTEXT: CardCase[] = [
  {
    title: 'Meeting context off',
    when: 'The default. The badge on the sentence card is muted. Hovering it explains how to turn it on in Settings.',
    state: on({ chips: TWO, sentence: SENTENCE }),
  },
  {
    title: 'Waiting for captions',
    when: 'The signer turned meeting context on. Ola waits for Meet’s live captions (the CC button).',
    state: on({
      chips: TWO,
      sentence: SENTENCE,
      context: { state: 'waiting', summary: null, updating: false },
    }),
  },
  {
    title: 'Following the meeting',
    when: 'Gemini has summarised the captions. The badge glows; hovering it shows the summary, which helps word the sentence.',
    state: on({
      chips: TWO,
      sentence: SENTENCE,
      context: {
        state: 'following',
        summary: 'The team is planning Thursday’s demo and asking when it starts.',
        updating: false,
      },
    }),
  },
];

function Frame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`frame ${className}`}>{children}</div>;
}

function Tile({
  title,
  when,
  children,
  wide,
}: {
  title: string;
  when: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <figure className={`tile${wide ? ' tile--wide' : ''}`}>
      {children}
      <figcaption>
        <strong>{title}</strong>
        <span>{when}</span>
      </figcaption>
    </figure>
  );
}

function CardTile({ c }: { c: CardCase }) {
  const view = viewOf(c.state);
  return (
    <Tile title={c.title} when={c.when}>
      <Frame className="frame--card">
        <PanelCard
          session={stubSession(c.state.on && !c.state.starting)}
          state={c.state}
          view={view}
          onToggle={noop}
          voiceMuted={c.voiceMuted ?? false}
          onVoiceMutedChange={noop}
          language="en"
          onLanguageChange={noop}
          onCollapse={noop}
          onOpenSettings={noop}
          showActions={c.showActions}
          demo={c.demo ?? true}
          dragHandlers={drag}
        />
      </Frame>
    </Tile>
  );
}

const STATUSES = Object.keys(STATUS_META) as Status[];

const PILL_CASES: Array<{ status: Status; label: string; enabled: boolean }> = [
  { status: 'off', label: 'Off', enabled: false },
  { status: 'starting', label: 'Starting camera', enabled: true },
  { status: 'ready', label: 'Ready', enabled: true },
  { status: 'signing', label: 'Signing', enabled: true },
  { status: 'recognising', label: 'Recognising', enabled: true },
  { status: 'speaking', label: 'Speaking', enabled: true },
  { status: 'attention', label: 'Camera blocked', enabled: true },
  { status: 'reconnecting', label: 'Reconnecting…', enabled: true },
];

const VOICES = [
  ['aria', 'Aria', 'Warm, female, US English'],
  ['nora', 'Nora', 'Bright, female, US English'],
  ['david', 'David', 'Calm, male, US English'],
  ['miles', 'Miles', 'Deep, male, US English'],
] as const;

function Components() {
  const [speak, setSpeak] = useState('auto');
  const [speed, setSpeed] = useState(1);
  const [voice, setVoice] = useState('aria');
  const [t1, setT1] = useState(false);
  return (
    <>
      <h3>Buttons</h3>
      <div className="row">
        <Button icon="wave">Speak (primary)</Button>
        <Button variant="secondary">Cancel (secondary)</Button>
        <Button variant="ghost">Report a problem (ghost)</Button>
        <Button variant="danger" icon="x">
          Turn Ola off (danger)
        </Button>
        <Button disabled>Disabled</Button>
        <Button variant="secondary" icon="gear" iconOnly>
          Settings
        </Button>
        <Button variant="ghost" icon="chevron-up" iconOnly>
          Expand Ola
        </Button>
      </div>
      <p className="note">
        Primary: the one main action. Secondary: the alternative. Ghost: quiet links. Danger: stops
        or removes. Icon-only buttons keep their name for screen readers.
      </p>

      <h3>Switches</h3>
      <div className="row">
        <Toggle label="Ola" checked={t1} onCheckedChange={setT1} />
        <Toggle label="On" checked onCheckedChange={noop} />
        <Toggle label="Locked on" checked disabled onCheckedChange={noop} />
      </div>
      <div className="row">
        <Segmented
          label="When to speak"
          value={speak}
          onValueChange={setSpeak}
          options={[
            { value: 'auto', label: 'Auto-speak', icon: 'wave' },
            { value: 'confirm', label: 'Confirm first', icon: 'check' },
          ]}
        />
      </div>
      <div className="row" style={{ maxWidth: 320 }}>
        <Slider
          label="Speaking speed"
          min={0.75}
          max={1.5}
          step={0.05}
          value={speed}
          onValueChange={setSpeed}
          format={(x) => `${x.toFixed(2)}×`}
        />
      </div>

      <h3>Status pill (all nine states)</h3>
      <div className="row">
        {STATUSES.map((s) => (
          <StatusPill key={s} status={s} />
        ))}
      </div>
      <p className="note">
        Every state has an icon and words, never colour alone. It is announced politely when it
        changes.
      </p>

      <h3>Sign chips</h3>
      <div className="row">
        <Chip>tomorrow</Chip>
        <Chip state="lowConfidence">think</Chip>
        <Chip state="confirmed">hello</Chip>→<Chip state="confirmed">please</Chip>→
        <Chip state="lowConfidence">wait</Chip>
      </div>

      <h3>Messages</h3>
      <div className="stack">
        <Banner tone="info">
          Unmute your Meet microphone, or reload this Meet tab once, so Ola can speak in the call.
        </Banner>
        <Banner tone="warning" title="Poor lighting. ">
          Move to a brighter spot.
        </Banner>
        <Banner
          tone="error"
          title="Camera blocked. "
          action={<Button variant="secondary">Fix permissions</Button>}
        >
          Allow camera access to use Ola.
        </Banner>
      </div>

      <h3>Voices</h3>
      <div role="radiogroup" aria-label="Voice" className="stack" style={{ maxWidth: 360 }}>
        {VOICES.map(([id, name, d]) => (
          <VoiceCard
            key={id}
            groupName="voice"
            name={name}
            description={d}
            selected={voice === id}
            onSelect={() => setVoice(id)}
            playing={id === 'david'}
          />
        ))}
      </div>

      <h3>Tabs, key hint, tooltip, logo</h3>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 300 }}>
          <Tabs
            label="Settings sections"
            tabs={[
              { id: 'voice', label: 'Voice', panel: <p>Voice and language choices.</p> },
              { id: 'signing', label: 'Signing', panel: <p>Pause and recognition choices.</p> },
              { id: 'about', label: 'About', panel: <p>Privacy and credits.</p> },
            ]}
          />
        </div>
        <span>
          Press <KeyHint>Enter</KeyHint> to speak
        </span>
        <Tooltip content="Hover or focus shows this">
          <Button variant="secondary">Hover me</Button>
        </Tooltip>
        <Wordmark />
        <Wordmark markOnly size={34} />
      </div>

      <h3>Icons ({ICON_NAMES.length})</h3>
      <ul className="icons">
        {ICON_NAMES.map((n) => (
          <li key={n}>
            <Icon name={n} size={22} />
            <span>{n}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Gallery() {
  const [theme, setTheme] = useState<Theme>('system');
  const [settings, setSettings] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  return (
    <ThemeRoot theme={theme} className="gallery">
      <header className="top">
        <div>
          <Wordmark />
          <h1>UI components</h1>
          <p>
            Every part of Ola’s interface, drawn by the real code in each state, with a note on when
            it appears.
          </p>
        </div>
        <Segmented
          label="Theme"
          value={theme}
          onValueChange={(v) => setTheme(v as Theme)}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </header>
      <nav aria-label="Sections" className="nav">
        <a href="#flow">Flow</a>
        <a href="#problems">Problems</a>
        <a href="#context">Meeting context</a>
        <a href="#pill">Collapsed pill</a>
        <a href="#captions">Captions</a>
        <a href="#settings">Settings</a>
        <a href="#signs">Signs list</a>
        <a href="#summary">Call summary</a>
        <a href="#onboarding">First-run screens</a>
        <a href="#components">Components</a>
      </nav>

      <main>
        <section id="flow">
          <h2>1. The main flow: from a sign to a voice</h2>
          <p>
            Read left to right, top to bottom. The card moves through these states as the signer
            works. The camera picture shows the hand dots once Ola is on.
          </p>
          <div className="grid">
            {FLOW.map((c) => (
              <CardTile key={c.title} c={c} />
            ))}
          </div>
        </section>

        <section id="problems">
          <h2>2. When something goes wrong</h2>
          <p>
            Problems are shown on the camera picture, one at a time, by priority (camera blocked
            first). None of them move the layout: the card keeps its size.
          </p>
          <div className="grid">
            {PROBLEMS.map((c) => (
              <CardTile key={c.title} c={{ ...c, demo: c.title.includes('Meet') ? false : true }} />
            ))}
          </div>
        </section>

        <section id="context">
          <h2>3. Meeting context (opt-in)</h2>
          <p>
            The brain badge on the top-right corner of the sentence card. It only works while the
            signer allows it in Settings and Meet’s captions are on.
          </p>
          <div className="grid">
            {CONTEXT.map((c) => (
              <CardTile key={c.title} c={{ ...c, demo: false }} />
            ))}
          </div>
        </section>

        <section id="pill">
          <h2>4. The collapsed pill</h2>
          <p>
            What the signer sees when the card is folded away: the logo, the status, the switch and
            an expand button. It sits above Meet’s own controls and opens by itself if something
            needs attention.
          </p>
          <div className="grid grid--pill">
            {PILL_CASES.map((p) => (
              <Tile key={p.label} title={p.label} when={`Status: ${p.status}`}>
                <Frame className="frame--pill">
                  <Pill {...p} onToggle={noop} onExpand={noop} />
                </Frame>
              </Tile>
            ))}
          </div>
        </section>

        <section id="captions">
          <h2>5. Captions on the signer’s screen</h2>
          <p>
            A caption bar styled like Meet’s own. Only the signer sees it; the other people hear the
            voice (and Meet captions that). Three sizes, top or bottom.
          </p>
          <div className="grid">
            {(['small', 'medium', 'large'] as const).map((size) => (
              <Tile
                key={size}
                title={`${size[0]!.toUpperCase()}${size.slice(1)} text`}
                when="Set in Settings → Captions."
              >
                <Frame className="frame--caption">
                  <CaptionBar
                    name="You"
                    text={SENTENCE}
                    speaking
                    size={size}
                    position="bottom"
                    clearance={0}
                  />
                </Frame>
              </Tile>
            ))}
            <Tile
              title="Docked at the top"
              when="Captions can sit at the top of the window instead."
            >
              <Frame className="frame--caption">
                <CaptionBar
                  name="You"
                  text="Where is the time?"
                  speaking={false}
                  size="medium"
                  position="top"
                  clearance={0}
                />
              </Frame>
            </Tile>
          </div>
        </section>

        <section id="settings">
          <h2>6. Settings</h2>
          <p>
            A drawer with five tabs (language and voice first, reference last). Open it here and
            click through the tabs; it is the real drawer.
          </p>
          <Button onClick={() => setSettings(true)} icon="gear">
            Open the Settings drawer
          </Button>
          <SettingsDrawer
            open={settings}
            onOpenChange={setSettings}
            modelId="on-device classifier"
          />
        </section>

        <section id="signs">
          <h2>7. The signs Ola knows</h2>
          <p>
            Settings → Signs. {SIGN_LIST.length} signs and short phrases, each with a small picture
            of the hand shape and where it is made.
          </p>
          <div className="frame frame--signs">
            <SignsGrid />
          </div>
        </section>

        <section id="summary">
          <h2>8. Call summary</h2>
          <p>
            Shown when the call ends: what Ola said for the signer, with times. Kept in memory only
            and cleared when closed.
          </p>
          {summaryOpen ? (
            <Frame className="frame--summary">
              <SummaryCard
                entries={[
                  { text: 'Hello, please wait.', at: Date.UTC(2026, 9, 15, 9, 2, 10) },
                  { text: 'Where is the time?', at: Date.UTC(2026, 9, 15, 9, 3, 41) },
                  { text: 'Thank you, I’m fine. Goodbye.', at: Date.UTC(2026, 9, 15, 9, 7, 5) },
                ]}
                feedbackConsent
                onCopy={async () => true}
                onFeedback={async () => true}
                onClose={() => setSummaryOpen(false)}
              />
            </Frame>
          ) : (
            <Button variant="secondary" onClick={() => setSummaryOpen(true)}>
              Show the summary again
            </Button>
          )}
        </section>

        <section id="onboarding">
          <h2>9. First-run screens (the extension’s welcome pages)</h2>
          <p>
            Shown once, in a browser tab, after installing: what Ola is, the camera permission,
            set-up (voice, name, sign check) and a finish page.
          </p>
          <div className="screens">
            <Tile wide title="Welcome" when="What Ola is and which video-call apps it works with.">
              <div className="screen">
                <Welcome onStart={noop} />
              </div>
            </Tile>
            <Tile
              wide
              title="Camera permission"
              when="Why the camera is needed and the privacy promise."
            >
              <div className="screen">
                <Permissions onBack={noop} onNext={noop} />
              </div>
            </Tile>
            <Tile wide title="Set-up" when="Voice, name and a quick check that signing is seen.">
              <div className="screen">
                <Setup onBack={noop} onFinish={noop} />
              </div>
            </Tile>
            <Tile wide title="Done" when="Finish page with how to start in a call.">
              <div className="screen">
                <Done />
              </div>
            </Tile>
          </div>
        </section>

        <section id="components">
          <h2>10. The building blocks</h2>
          <p>
            The shared components (package <code>@audion/ui</code>) that every screen above is made
            from.
          </p>
          <Components />
        </section>
      </main>
    </ThemeRoot>
  );
}

const rootStyle: CSSProperties = {};
createRoot(document.getElementById('root')!).render(
  <div style={rootStyle}>
    <Gallery />
  </div>,
);

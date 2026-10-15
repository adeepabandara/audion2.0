// The public web demo of Ola. Same panel, camera, hand tracking and recognition as the Chrome extension, but on an
// ordinary web page: there is no Meet call, so the voice just plays on the visitor's speakers, and the API is the
// same site (Cloud Run serves both). A small shim answers chrome.runtime.sendMessage by calling the API directly.
import { Wordmark } from '@audion/ui';
import ui from '@audion/ui/styles.css?inline';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMessageHandler } from '../background/handler';
import { createApiClient } from '../lib/api';
import { fromBase64, type Request } from '../lib/messages';
import { getSettingsStore } from '../lib/settings';
import { localStorageStore, memoryStore } from '../lib/storage';
import { AudionApp } from '../panel/AudionApp';
import { CAMERA_CONSTRAINTS } from '../lib/camera';
import { createDefaultSession } from '../panel/defaultSession';
import type { TraceEvent } from '../panel/session';
import panel from '../panel/panel.css?inline';
import { createPanelStore } from '../panel/store';
import { VOICES } from '@audion/shared';
import { playAudio } from '../lib/audioPlayer';
import { MeetingContext } from '../panel/meetingContext';
import { ScriptedCaptions } from './demoCaptions';
import { createGemma, GEMMA_SIZE_GB, type GemmaStatus } from './gemmaComposer';
import { LocalVoice } from './localVoice';
import { PipelineBus } from './pipeline/bus';
import { ArchitectureView } from './pipeline/ArchitectureView';

/** Collects what really happens, for the "behind the scenes" view. */
const bus = new PipelineBus();

const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  local: localStorageStore('ola:local:'),
});
const handle = createMessageHandler(api, async () => {}, memoryStore());

// Optional on-device sentences (Gemma). A single sign needs no model; if Gemma is off, not ready, or gives an
// answer that is not grounded in the signs, the request goes to the server (Gemini) as usual.
const gemma = createGemma();
const writer = document.getElementById('sentence-writer');
const noteWriter = (text: string) => writer && (writer.textContent = text);
async function send(req: Request, ctx: { tabId: string }) {
  if (req.type === 'api/compose' && req.signs.length > 1 && gemma.status().state === 'ready') {
    const sentence = await gemma.compose(req.signs, req.context);
    if (sentence) {
      noteWriter('Last sentence written by Gemma, on this device.');
      return { ok: true as const, sentence, writer: 'Gemma, on this device' };
    }
  }
  const started = performance.now();
  const res = await handle(req, ctx);
  if (req.type.startsWith('api/')) {
    bus.emit({
      kind: 'api',
      path: req.type,
      ok: !!(res as { ok?: boolean }).ok,
      ms: Math.round(performance.now() - started),
    });
  }
  if (req.type === 'api/compose' && res.ok) {
    // One sign is a fixed rule on the server; two or more are written by Gemini on Google Cloud.
    const writer =
      req.signs.length === 1
        ? 'a fixed rule (single sign)'
        : service.mock
          ? 'the mock sentence writer (test mode, not Gemini)'
          : 'Gemini, on Google Cloud';
    noteWriter(`Last sentence written by ${writer}.`);
    return { ...res, writer };
  }
  return res;
}
(window as unknown as { chrome: unknown }).chrome = {
  runtime: { id: 'ola-web', sendMessage: (req: Request) => send(req, { tabId: 'web' }) },
};

// The real Ola by Audion logo in the page header (the same vector the panel and the extension use).
const brand = document.getElementById('brand');
if (brand) createRoot(brand).render(<Wordmark size={64} />);

// The widget lives INSIDE the call window (not on the page): it scrolls and maximises with it, and the panel keeps
// itself within the window (`bounds`). The window is the containing block for the panel's fixed positioning.
const callWindow = document.getElementById('call-stage');
const host = document.createElement('div');
host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;';
(callWindow ?? document.body).append(host);
const shadow = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = ui + panel;
shadow.append(style);
const container = document.createElement('div');
/** A video file is shown as it is; only a live camera is mirrored like a mirror. */
const showUnmirrored = (on: boolean) => container.classList.toggle('ap-unmirrored', on);
shadow.append(container);
for (const type of ['keydown', 'keyup', 'keypress'])
  host.addEventListener(type, (e) => e.stopPropagation());

// Test without a camera: a video file the visitor picks plays in place of the camera (it never leaves the browser).
let testVideo: HTMLVideoElement | null = null;
async function getCamera(): Promise<MediaStream> {
  if (!testVideo) return navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
  testVideo.currentTime = 0;
  await testVideo.play();
  // Pictures only: the clip sent for recognition should not carry the video's soundtrack.
  const stream = (testVideo as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
  return new MediaStream(stream.getVideoTracks());
}

// The demo's "meeting": scripted captions, followed by the same tracker the extension uses on Meet's captions.
const captions = new ScriptedCaptions();
const meeting = new MeetingContext({
  send: (req) =>
    (
      window as unknown as { chrome: { runtime: { sendMessage(r: Request): Promise<unknown> } } }
    ).chrome.runtime.sendMessage(req),
  watch: captions.watch,
  // Quicker than the extension's once-a-minute refresh, so a visitor sees the summary appear and update.
  intervalMs: 20_000,
  firstMs: 8_000,
});

const session = createDefaultSession('/tracker.html', shadow, {
  getCamera,
  context: meeting,
  voice: new LocalVoice(),
  chat: async () => 'no-chat',
});
// Every visit starts the way the extension does in a call: Ola collapsed to its small pill, inside the meeting. The
// panel's open/closed state is kept in memory only here, so it does not come back open from an earlier visit.
const panelStore = createPanelStore(memoryStore());
createRoot(container).render(
  <AudionApp
    session={session}
    portalContainer={container}
    panelStore={panelStore}
    bounds={callWindow}
    alwaysShow
    demo
  />,
);

// "Open Ola" buttons on the landing page.
for (const el of document.querySelectorAll('[data-open-ola]')) {
  el.addEventListener('click', () => panelStore.useStore.getState().setExpanded(true));
}

// Service status line: is the API reachable, and which model answers.
let voiceSource = 'Google Text-to-Speech';
/** What answers in the cloud, from /healthz: shown honestly in the pipeline log (mock mode is not Gemini). */
const service = { mock: false, modelId: '' };
const cloudName = () => (service.mock ? 'the mock recogniser (test mode, not Gemini)' : 'Gemini');
const status = document.getElementById('service-status');
const say = (text: string) => {
  if (status) status.textContent = text;
};
fetch('/v1/health')
  .then(
    (r) => r.json() as Promise<{ ok?: boolean; mode?: string; modelId?: string; voices?: string }>,
  )
  .then((h) => {
    service.mock = h.mode === 'mock';
    service.modelId = h.modelId ?? '';
    bus.emit({
      kind: 'service',
      mode: h.mode ?? 'mock',
      modelId: h.modelId ?? '',
      voices: h.voices ?? '',
    });
    voiceSource = h.voices === 'mock' ? 'a placeholder tone (mock mode)' : 'Google Text-to-Speech';
    say(
      h.ok
        ? `Online. Recognition model: ${h.modelId ?? 'unknown'}. Voices: ${
            h.voices === 'google' ? 'Google Cloud Text-to-Speech' : 'placeholder tone (mock mode)'
          }.`
        : 'The service answered, but reported a problem.',
    );
  })
  .catch(() => say('The service cannot be reached right now.'));

// The Gemma switch. It turns itself on when the visitor first turns Ola on, unless they have unticked it before
// or their browser asks for less data; their choice is remembered.
const toggle = document.getElementById('gemma-toggle') as HTMLInputElement | null;
const gemmaStatus = document.getElementById('gemma-status');
const describe = (s: GemmaStatus): string => {
  switch (s.state) {
    case 'off':
      return `Off. Sentences are written by Gemini on Google Cloud. Tick the box to use Gemma (about ${GEMMA_SIZE_GB} GB, downloaded once).`;
    case 'loading':
      return `Getting the model ready (about ${GEMMA_SIZE_GB} GB, kept in your browser after the first time)${
        s.progress === null ? '' : `: ${Math.round(s.progress * 100)}%`
      }. Gemini writes the sentences meanwhile.`;
    case 'ready':
      return 'On. Sentences with two or more signs are written on this device. Gemini stays as the backup.';
    case 'unsupported':
      return s.reason;
    case 'failed':
      return `The model did not start (${s.reason}). Ola is using Gemini instead.`;
  }
};
if (toggle && gemmaStatus) {
  gemma.subscribe((st) => {
    gemmaStatus.textContent = describe(st);
    toggle.checked = st.state === 'loading' || st.state === 'ready';
  });
  gemmaStatus.textContent = describe(gemma.status());
  toggle.addEventListener('change', () => {
    remember(toggle.checked ? 'on' : 'off');
    if (toggle.checked) void gemma.enable();
    else gemma.disable();
  });
}
const PREF_KEY = 'ola:gemma';
function remember(v: 'on' | 'off') {
  try {
    localStorage.setItem(PREF_KEY, v);
  } catch {
    /* storage blocked: the choice just is not remembered */
  }
}
function remembered(): string | null {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
}
const dataSaver = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
let autoStarted = false;
session.subscribe((state) => {
  if (!state.on || autoStarted) return;
  autoStarted = true;
  if (remembered() !== 'off' && !dataSaver) void gemma.enable();
});

// "Hear the voices": one button per Google Text-to-Speech voice, through the same /v1/speak the panel uses.
const voiceButtons = document.getElementById('voice-buttons');
const voiceStatus = document.getElementById('voice-status');
if (voiceButtons) {
  for (const v of VOICES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'voice';
    b.textContent = `${v.label} (${v.gender})`;
    b.setAttribute('aria-label', `Hear ${v.label}, a ${v.gender} voice`);
    b.addEventListener('click', async () => {
      if (voiceStatus) voiceStatus.textContent = `Getting ${v.label}…`;
      const res = await (
        window as unknown as {
          chrome: { runtime: { sendMessage(r: Request): Promise<unknown> } };
        }
      ).chrome.runtime.sendMessage({
        type: 'api/speak',
        text: `Hello, I'm ${v.label}. I speak for you with Ola.`,
        voiceId: v.id,
        speed: 1,
      });
      const r = res as { ok: boolean; audioBase64?: string };
      if (!r.ok || !r.audioBase64) {
        if (voiceStatus) voiceStatus.textContent = `Could not get ${v.label} right now.`;
        return;
      }
      if (voiceStatus) voiceStatus.textContent = `Playing ${v.label}.`;
      await playAudio(fromBase64(r.audioBase64)).catch(() => {});
      if (voiceStatus) voiceStatus.textContent = '';
    });
    voiceButtons.append(b);
  }
}

// "Test with a video": pick a file, then turn Ola on; it plays instead of the camera.
const testInput = document.getElementById('test-video') as HTMLInputElement | null;
const testSpeed = document.getElementById('test-speed') as HTMLSelectElement | null;
const testStatus = document.getElementById('test-status');
if (testInput) {
  const say = (text: string) => testStatus && (testStatus.textContent = text);
  testInput.addEventListener('change', () => {
    const file = testInput.files?.[0];
    if (testVideo) {
      testVideo.pause();
      URL.revokeObjectURL(testVideo.src);
      testVideo.remove();
      testVideo = null;
      showUnmirrored(false);
    }
    if (!file) return say('The camera will be used.');
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = URL.createObjectURL(file);
    v.playbackRate = Number(testSpeed?.value ?? 1);
    v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.append(v);
    v.addEventListener('error', () =>
      say('That video could not be opened. Try an MP4 or WebM file.'),
    );
    v.addEventListener('loadedmetadata', () => {
      testVideo = v;
      showUnmirrored(true);
      say(`Ready: “${file.name}” will play instead of the camera. Turn Ola on to start it.`);
    });
  });
  testSpeed?.addEventListener('change', () => {
    if (testVideo) testVideo.playbackRate = Number(testSpeed.value);
  });
}

// "Live pipeline": what each step did for the last signs, so you can see which model answered.
const traceList = document.getElementById('trace');
if (traceList) {
  const sec = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
  const line = (e: TraceEvent): string => {
    switch (e.kind) {
      case 'device':
        return `Sign “${e.sign}” named on this device (${Math.round(e.confidence * 100)}% sure, ${sec(e.ms)}).`;
      case 'device-unsure':
        return `On-device model unsure (“${e.sign}”, ${Math.round(e.confidence * 100)}%, it needs ${Math.round(e.threshold * 100)}%), ${
          e.then === 'retry'
            ? 'so the sign was not accepted: sign it again.'
            : `so ${cloudName()} decides.`
        }`;
      case 'cloud':
        if (e.role === 'answer') return `Sign “${e.sign}” named by ${cloudName()} (${sec(e.ms)}).`;
        if (e.sign === 'unknown')
          return `Check by ${cloudName()} could not tell, so “${e.deviceSign}” stands (${sec(e.ms)}).`;
        return e.sign === e.deviceSign
          ? `Check by ${cloudName()} agreed: “${e.sign}” (${sec(e.ms)}).`
          : `Check by ${cloudName()} changed “${e.deviceSign}” to “${e.sign}” (${sec(e.ms)}).`;
      case 'sentence':
        return `Sentence “${e.sentence}” written by ${e.writer} (${sec(e.ms)}).`;
      case 'context':
        return `Meeting context updated from ${e.chars} characters of captions: “${e.summary}” (${sec(e.ms)}).`;
      case 'translate':
        return `Translated to ${e.language} (${sec(e.ms)}).`;
      case 'voice': {
        const v = VOICES.find((x) => x.id === e.voiceId);
        return `Voice ${v?.label ?? e.voiceId} by ${voiceSource} (${sec(e.ms)}).`;
      }
    }
  };
  session.onTrace((e) => {
    const li = document.createElement('li');
    li.textContent = `${new Date().toLocaleTimeString()}  ${line(e)}`;
    traceList.prepend(li);
    while (traceList.children.length > 14) traceList.lastElementChild?.remove();
  });
}

// "Maximise": the call window fills the screen (Esc or the same control puts it back). Two controls do it, like a
// real window: the green dot at the top left and an expand button at the bottom right of the call. The Ola panel is
// positioned against the screen, so with the window maximised it sits over the call as it would in a real meeting.
const browserWindow = document.getElementById('browser');
const maxButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-maximise]')];
if (browserWindow && maxButtons.length) {
  const setMax = (on: boolean) => {
    browserWindow.classList.toggle('is-max', on);
    document.body.classList.toggle('max-open', on);
    for (const b of maxButtons) {
      const label = on ? 'Exit full screen' : 'Maximise window';
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', label);
      b.title = label;
    }
  };
  for (const b of maxButtons)
    b.addEventListener('click', () => setMax(!browserWindow.classList.contains('is-max')));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && browserWindow.classList.contains('is-max')) setMax(false);
  });
}

// The other people in the call are short looped videos. Anything that moves by itself for more than a few seconds
// needs a way to stop it, and people who ask their system for less motion get them paused from the start.
const callVideos = [...document.querySelectorAll<HTMLVideoElement>('[data-call-video]')];
const pauseButton = document.getElementById('pause-videos') as HTMLButtonElement | null;
if (callVideos.length && pauseButton) {
  const setPaused = (paused: boolean) => {
    pauseButton.setAttribute('aria-pressed', String(paused));
    pauseButton.textContent = paused ? 'Play call videos' : 'Pause call videos';
    for (const v of callVideos) {
      if (paused) v.pause();
      else void v.play().catch(() => {});
    }
  };
  pauseButton.addEventListener('click', () =>
    setPaused(pauseButton.getAttribute('aria-pressed') !== 'true'),
  );
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPaused(true);
}

// The extension's icon in the browser bar: a black box with the Ola wordmark, like the widget.
const toolbarMark = document.getElementById('toolbar-mark');
if (toolbarMark) createRoot(toolbarMark).render(<Wordmark markOnly size={13} />);

// The Ola icon in the browser bar opens and closes the panel, as the toolbar icon of the real extension does.
const toolbarOla = document.getElementById('toolbar-ola');
toolbarOla?.addEventListener('click', () => {
  const { expanded, setExpanded } = panelStore.useStore.getState();
  setExpanded(!expanded);
});

// Captions in the call window, and the meeting summary on the page. The meeting starts when the page loads, like a
// meeting that is already going on; Ola only follows it (and sends it for summarising) if the setting is on.
const strip = document.getElementById('meet-captions');
captions.view((recent) => {
  if (!strip) return;
  strip.replaceChildren(
    ...recent.map((l) => {
      const p = document.createElement('p');
      const who = document.createElement('strong');
      who.textContent = `${l.speaker}: `;
      p.append(who, l.text);
      return p;
    }),
  );
});
captions.start();

const contextBox = document.getElementById('context-box');
session.subscribe((state) => {
  if (!contextBox) return;
  const { state: s, summary } = state.context;
  contextBox.textContent =
    s === 'off'
      ? 'Not following the meeting. Turn Ola on, with “Use the meeting to word sentences” on in its settings, and Ola starts following the captions.'
      : summary
        ? summary
        : 'Following the captions. The first summary appears in a few seconds.';
});

// A first-time visitor gets the meeting context switched on (the captions are scripted, not real people); after
// that their own choice in Settings is kept.
void getSettingsStore()
  .init()
  .then(() => {
    try {
      if (localStorage.getItem('ola:meeting-context-default')) return;
      localStorage.setItem('ola:meeting-context-default', '1');
    } catch {
      /* storage blocked: leave the setting as it is */
    }
    void getSettingsStore().useStore.getState().update({ meetingContext: true });
  });

// ---- "Behind the scenes": feed the real events of this page into the live architecture view. ----
session.onTrace((e) => bus.emit(e)); // signs, Gemini checks, sentences, voice and meeting summaries
session.onFrame((f) => bus.emit({ kind: 'frame', hands: f.hands.length }));
let wasSigning = false;
session.subscribe((st) => {
  if (st.signing !== wasSigning) {
    wasSigning = st.signing;
    bus.emit({ kind: 'signing', on: st.signing });
  }
});
gemma.subscribe((g) => bus.emit({ kind: 'gemma', state: g.state }));
captions.view((recent) => {
  const last = recent[recent.length - 1];
  if (last) bus.emit({ kind: 'caption', speaker: last.speaker, text: last.text });
});

/** The full-screen view and the button that opens it. Focus returns to the button when it closes. */
function ArchitectureHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.body.classList.toggle('arch-open', open);
  }, [open]);
  useEffect(() => {
    const button = document.getElementById('open-architecture');
    const show = () => setOpen(true);
    button?.addEventListener('click', show);
    return () => button?.removeEventListener('click', show);
  }, []);
  return (
    <ArchitectureView
      bus={bus}
      open={open}
      onClose={() => {
        setOpen(false);
        document.getElementById('open-architecture')?.focus();
      }}
    />
  );
}
const architectureRoot = document.getElementById('architecture-root');
if (architectureRoot) createRoot(architectureRoot).render(<ArchitectureHost />);

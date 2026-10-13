// Dev harness: mounts Audion into a Shadow root on the fake-meet page, exactly as the content script does,
// but without the extension runtime: a small shim answers chrome.runtime.sendMessage by calling the API
// directly, and storage falls back to localStorage. The MAIN-world inject script is installed here too
// (same window), so fake-meet's own getUserMedia call gets Audion's mixed microphone track.
//   pnpm --filter @audion/extension build   (builds the tracker page + MediaPipe assets the harness serves)
//   pnpm --filter @audion/extension harness
// Open http://localhost:4173/?harness=1 (add &fakecam=1&fakemic=1 for fake devices). ?fakecam=1 swaps video getUserMedia for an animated canvas stream, ?fakemic=1 swaps audio for a
// silent oscillator-free stream (no real devices needed).
import ui from '@audion/ui/styles.css?inline';
import { createRoot } from 'react-dom/client';
import { createMessageHandler } from '../src/background/handler';
import { installInject } from '../src/inject/install';
import { createApiClient } from '../src/lib/api';
import type { Request } from '../src/lib/messages';
import { localStorageStore, memoryStore } from '../src/lib/storage';
import { AudionApp } from '../src/panel/AudionApp';
import { createDefaultSession } from '../src/panel/defaultSession';
import panel from '../src/panel/panel.css?inline';
import { makeFrames, type Segment } from '../src/testing/fixtures';

const flags = new URLSearchParams(location.search);

// Fake devices go in BEFORE the inject script wraps getUserMedia, exactly where the real devices would be.
const md = navigator.mediaDevices;
const realGum = md.getUserMedia.bind(md);
md.getUserMedia = async (c) => {
  const tracks: MediaStreamTrack[] = [];
  if (c?.video && flags.has('fakecam')) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const g = canvas.getContext('2d')!;
    let n = 0;
    setInterval(() => {
      g.fillStyle = '#5a6b7a'; // mid-grey: passes the light check
      g.fillRect(0, 0, 640, 480);
      g.fillStyle = '#e8c9a0';
      g.beginPath();
      g.arc(320 + Math.sin(n++ / 10) * 120, 240, 60, 0, Math.PI * 2);
      g.fill();
    }, 33);
    tracks.push(...canvas.captureStream(30).getVideoTracks());
  } else if (c?.video) {
    return realGum(c);
  }
  if (c?.audio && flags.has('fakemic')) {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination(); // silent "microphone"
    tracks.push(...dest.stream.getAudioTracks());
  } else if (c?.audio) {
    return realGum(c);
  }
  return new MediaStream(tracks);
};
installInject();

const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL,
  local: localStorageStore('audion:local:'),
});
const handle = createMessageHandler(
  api,
  async () => console.warn('harness: would open chrome camera settings'),
  memoryStore(), // transcript, like the service worker's session storage
);
(window as unknown as { chrome: unknown }).chrome = {
  runtime: { id: 'harness', sendMessage: (req: Request) => handle(req, { tabId: 'harness' }) },
};

const host = document.createElement('div');
document.body.append(host);
const shadow = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = ui + panel;
shadow.append(style);
const container = document.createElement('div');
shadow.append(container);
for (const type of ['keydown', 'keyup', 'keypress'])
  host.addEventListener(type, (e) => e.stopPropagation());

const session = createDefaultSession('/tracker.html', shadow);
createRoot(container).render(
  <AudionApp session={session} portalContainer={container} alwaysShow />,
);

// Dev-only: drive the pipeline with synthetic landmarks (no hand needed) and poke it from the console.
async function simulate(script: Segment[]) {
  let t = performance.now();
  for (const f of makeFrames(script, t)) {
    await new Promise((r) => setTimeout(r, 1000 / 15));
    await session.tick({ ...f, t: (t += 1000 / 15) });
  }
}
const SIGN: Segment[] = [
  { kind: 'still', ms: 300 },
  { kind: 'move', ms: 1500 },
  { kind: 'still', ms: 700 },
];
(window as unknown as { __audion: unknown }).__audion = { session, simulate, SIGN, makeFrames };
const bar = document.createElement('div');
bar.style.cssText =
  'position:fixed;left:8px;top:8px;display:flex;gap:6px;z-index:99999;font:12px system-ui';
for (const [label, run] of [
  ['Simulate sign', () => simulate(SIGN)],
  ['Simulate 2 signs + pause', () => simulate([...SIGN, ...SIGN, { kind: 'none', ms: 2200 }])],
] as const) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => void run();
  bar.append(b);
}
// Record real hand landmarks (no video, no audio: just hand-skeleton points) for tuning the segmenter:
//   pnpm --filter @audion/eval segment ~/Downloads/audion-recording.landmarks.json
// Switch Audion on, press Record, then sign normally for 20 s. Keep these files local; they describe a person's
// hands, so only share or commit recordings the signer has agreed to share.
const rec = document.createElement('button');
rec.textContent = 'Record landmarks (20 s)';
rec.onclick = () => {
  const frames: unknown[] = [];
  const off = session.onFrame((f) => frames.push(f));
  rec.disabled = true;
  rec.textContent = 'Recording…';
  setTimeout(() => {
    off();
    const blob = new Blob([JSON.stringify({ version: 1, frames })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'audion-recording.landmarks.json';
    a.click();
    rec.disabled = false;
    rec.textContent = 'Record landmarks (20 s)';
  }, 20_000);
};
bar.append(rec);
document.body.append(bar);

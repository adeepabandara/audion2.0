import {
  ALLOWED_HOST_ORIGINS,
  isToTracker,
  TRACKER_SOURCE,
  type FromTracker,
} from '../lib/trackerProtocol';
import { classify, toGrid, type ClassifierModel } from '../lib/classifier';
import { createEngine } from './engine';

// The tracker page is only ever framed by Meet (or the local fake Meet page in dev builds).
// ancestorOrigins is Chrome-only; the web demo embeds this page from its own origin, so fall back to that there.
const parentOrigin =
  location.ancestorOrigins?.[0] ?? (process.env.AUDION_WEB === '1' ? location.origin : undefined);
const trusted = !!parentOrigin && ALLOWED_HOST_ORIGINS.includes(parentOrigin);

const reply = (msg: FromTracker) => parentOrigin && window.parent.postMessage(msg, parentOrigin);
const base = new URL('./', location.href).href;

let engine: Awaited<ReturnType<typeof createEngine>> | null = null;
let starting: Promise<void> | null = null;
/** The on-device sign model (a ~2 MB file next to this page). Without it the cloud recognises every sign. */
let signModel: ClassifierModel | null = null;
const signModelLoading: Promise<void> = fetch(`${base}models/signclf.json`)
  .then((r) => (r.ok ? (r.json() as Promise<ClassifierModel>) : null))
  .then((m) => void (signModel = m))
  .catch(() => {});

async function init() {
  try {
    engine = await createEngine(base);
    reply({ source: TRACKER_SOURCE, type: 'ready', delegate: engine.delegate });
  } catch (e) {
    reply({
      source: TRACKER_SOURCE,
      type: 'error',
      message: `Couldn’t load hand tracking (${(e as Error).message}).`,
    });
  }
}

window.addEventListener('message', (e) => {
  if (!trusted || e.source !== window.parent || e.origin !== parentOrigin || !isToTracker(e.data))
    return;
  const msg = e.data;
  if (msg.type === 'init') {
    starting ??= init();
  } else if (msg.type === 'frame') {
    const { bitmap, id, t } = msg;
    try {
      reply({
        source: TRACKER_SOURCE,
        type: 'landmarks',
        id,
        t,
        hands: engine ? engine.detect(bitmap, t) : [],
      });
    } catch (err) {
      reply({ source: TRACKER_SOURCE, type: 'landmarks', id, t, hands: [] });
      console.warn('tracker: detect failed', err);
    } finally {
      bitmap.close();
    }
  } else if (msg.type === 'classify') {
    void signModelLoading.then(() => {
      let result = null;
      try {
        const r = signModel
          ? classify(signModel, toGrid(msg.frames, msg.startT, msg.endT), msg.aspect)
          : null;
        result = r && { ...r, threshold: signModel!.threshold };
      } catch (err) {
        console.warn('tracker: classify failed', err);
      }
      reply({ source: TRACKER_SOURCE, type: 'classified', id: msg.id, result });
    });
  }
});

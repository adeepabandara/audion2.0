import {
  ALLOWED_HOST_ORIGINS,
  isToTracker,
  TRACKER_SOURCE,
  type FromTracker,
} from '../lib/trackerProtocol';
import { createEngine } from './engine';

// The tracker page is only ever framed by Meet (or the local fake Meet page in dev builds).
const parentOrigin = location.ancestorOrigins?.[0];
const trusted = !!parentOrigin && ALLOWED_HOST_ORIGINS.includes(parentOrigin);

const reply = (msg: FromTracker) => parentOrigin && window.parent.postMessage(msg, parentOrigin);
const base = new URL('./', location.href).href;

let engine: Awaited<ReturnType<typeof createEngine>> | null = null;
let starting: Promise<void> | null = null;

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
  }
});

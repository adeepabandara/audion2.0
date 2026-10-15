import type { ApiClient } from '../lib/api';
import { fromBase64, toBase64, type Request, type TranscriptEntry } from '../lib/messages';
import type { KeyValueStore } from '../lib/storage';

const MAX_ENTRIES = 200;

export interface HandlerContext {
  /** The tab the message came from; transcripts are kept per call tab. */
  tabId: number | string | undefined;
}

/**
 * Maps extension messages to API calls and transcript storage. Shared by the service worker and the dev harness.
 * The transcript lives in `session` storage: memory-backed (survives the worker being suspended, never written
 * to disk, gone when the browser closes) and is cleared when the summary is closed or the tab goes away.
 */
export function createMessageHandler(
  api: ApiClient,
  openCameraSettings: () => Promise<unknown>,
  transcripts: KeyValueStore,
) {
  const key = (ctx: HandlerContext) => `transcript:${ctx.tabId ?? 'unknown'}`;
  const read = async (ctx: HandlerContext) =>
    ((await transcripts.get(key(ctx))) as TranscriptEntry[] | undefined) ?? [];

  return async function handle(req: Request, ctx: HandlerContext = { tabId: undefined }) {
    switch (req.type) {
      case 'ui/openCameraSettings':
        await openCameraSettings();
        return { ok: true as const };
      case 'api/health':
        return api.health();
      case 'api/speak': {
        const r = await api.speak({
          text: req.text,
          voiceId: req.voiceId as never,
          speed: req.speed,
        });
        return r.ok
          ? { ok: true as const, audioBase64: toBase64(r.audio), contentType: r.contentType }
          : r;
      }
      case 'api/recognize':
        return api.recognize(
          new Blob([fromBase64(req.clipBase64)], { type: req.mime }),
          req.mime,
          req.durationMs,
        );
      case 'api/compose':
        return api.compose({
          signs: req.signs,
          tone: req.tone,
          ...(req.context ? { context: req.context } : {}),
        });
      case 'api/context':
        return api.context({
          transcript: req.transcript,
          ...(req.previous ? { previous: req.previous } : {}),
        });
      case 'api/feedback':
        return api.feedback({ rating: req.rating, signs: req.signs });
      case 'transcript/add': {
        const entries = [...(await read(ctx)), { text: req.text, at: Date.now() }].slice(
          -MAX_ENTRIES,
        );
        await transcripts.set(key(ctx), entries);
        return { ok: true as const };
      }
      case 'transcript/get':
        return { ok: true as const, entries: await read(ctx) };
      case 'transcript/clear':
        await transcripts.set(key(ctx), []);
        return { ok: true as const };
    }
  };
}

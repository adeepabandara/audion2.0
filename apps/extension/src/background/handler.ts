import type { ApiClient } from '../lib/api';
import { fromBase64, toBase64, type Request } from '../lib/messages';

/** Maps extension messages to API calls. Shared by the service worker and the dev harness. */
export function createMessageHandler(api: ApiClient, openCameraSettings: () => Promise<unknown>) {
  return async function handle(req: Request) {
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
        return api.compose({ signs: req.signs, tone: req.tone });
    }
  };
}

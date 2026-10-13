import { chromeStore } from '../lib/storage';
import { createApiClient } from '../lib/api';
import { fromBase64, toBase64, type Request } from '../lib/messages';

const WELCOME_PATH = '/welcome.html';

export function startBackground() {
  const api = createApiClient({
    baseUrl: import.meta.env.VITE_API_URL,
    local: chromeStore('local'),
  });

  chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_PATH) });
  });

  chrome.runtime.onMessage.addListener((raw: Request, sender, sendResponse) => {
    // Only our own extension pages and content scripts may use the API through us.
    if (sender.id !== chrome.runtime.id) return false;
    void handle(raw).then(sendResponse);
    return true; // async response
  });

  async function handle(req: Request) {
    switch (req.type) {
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
  }
}

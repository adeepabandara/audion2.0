import { createApiClient } from '../lib/api';
import type { Request } from '../lib/messages';
import { chromeStore } from '../lib/storage';
import { createMessageHandler } from './handler';

const WELCOME_PATH = '/welcome.html';

export function startBackground() {
  const api = createApiClient({
    baseUrl: import.meta.env.VITE_API_URL,
    local: chromeStore('local'),
  });
  const transcripts = chromeStore('session'); // memory-backed; see handler.ts
  // Extensions may open chrome:// pages with tabs.create; content scripts cannot, so the worker does it.
  const handle = createMessageHandler(
    api,
    () => chrome.tabs.create({ url: 'chrome://settings/content/camera' }),
    transcripts,
  );

  chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_PATH) });
  });

  chrome.runtime.onMessage.addListener((raw: Request, sender, sendResponse) => {
    // Only our own extension pages and content scripts may use the API through us.
    if (sender.id !== chrome.runtime.id) return false;
    void handle(raw, { tabId: sender.tab?.id }).then(sendResponse);
    return true; // async response
  });

  // A closed tab takes its transcript with it.
  chrome.tabs.onRemoved.addListener((tabId) => void transcripts.set(`transcript:${tabId}`, []));
}

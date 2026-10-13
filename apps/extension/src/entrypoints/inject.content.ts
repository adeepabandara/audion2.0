import { installInject } from '../inject/install';

const FAKE_MEET = process.env.AUDION_FAKE_MEET === '1';

// MAIN world, before Meet's own scripts: this is what lets Audion's voice become the outgoing microphone track.
export default defineContentScript({
  matches: ['https://meet.google.com/*', ...(FAKE_MEET ? ['http://localhost:4173/*'] : [])],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installInject();
  },
});

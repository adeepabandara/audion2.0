import '@audion/ui/styles.css';
import { createRoot } from 'react-dom/client';
import { AudionApp } from '../panel/AudionApp';
import { ErrorBoundary } from '../panel/ErrorBoundary';
import { createDefaultSession } from '../panel/defaultSession';
import { installE2eHook } from '../panel/e2eHook';
import '../panel/panel.css';

// Dev builds can also run on the local fake Meet page: AUDION_FAKE_MEET=1 pnpm --filter @audion/extension build
const FAKE_MEET = process.env.AUDION_FAKE_MEET === '1';
// End-to-end test hook: compiled in only for AUDION_E2E=1 builds (see panel/e2eHook.ts).
const E2E = process.env.AUDION_E2E === '1';

export default defineContentScript({
  matches: ['https://meet.google.com/*', ...(FAKE_MEET ? ['http://localhost:4173/*'] : [])],
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'audion-root',
      position: 'inline',
      anchor: 'body',
      append: 'last',
      // Keep typing inside Audion from triggering Meet's keyboard shortcuts.
      isolateEvents: ['keydown', 'keyup', 'keypress'],
      onMount(container) {
        const root = createRoot(container);
        const session = createDefaultSession(
          browser.runtime.getURL('/tracker.html'),
          container.getRootNode(),
        );
        if (E2E) installE2eHook(session);
        root.render(
          <ErrorBoundary>
            <AudionApp
              session={session}
              portalContainer={container}
              alwaysShow={FAKE_MEET && location.hostname === 'localhost'}
            />
          </ErrorBoundary>,
        );
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});

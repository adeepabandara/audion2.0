import { ThemeRoot } from '@audion/ui';
import { useCallback, useEffect, useState } from 'react';
import { getSettingsStore } from '../../lib/settings';
import { Done } from './Done';
import { Intro } from './Intro';
import { Permissions } from './Permissions';
import { Setup } from './Setup';
import { Welcome } from './Welcome';

const ROUTES = ['welcome', 'permissions', 'setup', 'done'] as const;
type Route = (typeof ROUTES)[number];

function routeFromHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(h) ? (h as Route) : 'welcome';
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** `intro`: show the 3-second logo intro when the page loads on the welcome step (not for reduced motion). */
export function OnboardingApp({ intro = false }: { intro?: boolean }) {
  const { useStore, init } = getSettingsStore();
  const theme = useStore((s) => s.settings.theme);
  const ready = useStore((s) => s.ready);
  const update = useStore((s) => s.update);
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [showIntro, setShowIntro] = useState(
    () => intro && routeFromHash() === 'welcome' && !prefersReducedMotion(),
  );
  const endIntro = useCallback(() => setShowIntro(false), []);

  useEffect(() => {
    const unsub = init();
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      void unsub.then((u) => u());
    };
  }, [init]);

  const go = (r: Route) => {
    location.hash = `/${r}`;
    window.scrollTo(0, 0);
  };

  if (!ready) return <ThemeRoot theme={theme} />;
  if (showIntro)
    return (
      <ThemeRoot theme={theme}>
        <Intro onDone={endIntro} />
      </ThemeRoot>
    );
  return (
    <ThemeRoot theme={theme}>
      {route === 'welcome' && <Welcome onStart={() => go('permissions')} />}
      {route === 'permissions' && (
        <Permissions onBack={() => go('welcome')} onNext={() => go('setup')} />
      )}
      {route === 'setup' && (
        <Setup
          onBack={() => go('permissions')}
          onFinish={() => void update({ onboardingDone: true }).then(() => go('done'))}
        />
      )}
      {route === 'done' && <Done />}
    </ThemeRoot>
  );
}

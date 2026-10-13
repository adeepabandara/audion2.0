import { ThemeRoot } from '@audion/ui';
import { useEffect, useState } from 'react';
import { getSettingsStore } from '../../lib/settings';
import { Done } from './Done';
import { Permissions } from './Permissions';
import { Setup } from './Setup';
import { Welcome } from './Welcome';

const ROUTES = ['welcome', 'permissions', 'setup', 'done'] as const;
type Route = (typeof ROUTES)[number];

function routeFromHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(h) ? (h as Route) : 'welcome';
}

export function OnboardingApp() {
  const { useStore, init } = getSettingsStore();
  const theme = useStore((s) => s.settings.theme);
  const ready = useStore((s) => s.ready);
  const update = useStore((s) => s.update);
  const [route, setRoute] = useState<Route>(routeFromHash);

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

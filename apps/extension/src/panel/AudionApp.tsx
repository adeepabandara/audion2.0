import { ThemeRoot, type Status } from '@audion/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { locateControlBar, isMeetCallPath } from '../lib/meetDom';
import { getSettingsStore } from '../lib/settings';
import { PanelCard } from './PanelCard';
import { Pill } from './Pill';
import { SettingsDrawer } from './SettingsDrawer';
import { SignsSheet } from './SignsSheet';
import {
  barClearance,
  clampPosition,
  EDGE_MARGIN,
  FALLBACK_BAR_CLEARANCE,
  type Position,
} from './position';
import { getPanelStore } from './store';
import { useDrag } from './useDrag';

const CARD_FALLBACK = { width: 336, height: 480 };

/** Clearance above Meet's control bar, re-measured on resize and every 1.5 s (Meet re-renders its bar freely). */
function useBarClearance(): number {
  const [clearance, setClearance] = useState(FALLBACK_BAR_CLEARANCE);
  useEffect(() => {
    const update = () => setClearance(barClearance(locateControlBar()?.top ?? null, innerHeight));
    update();
    const id = setInterval(update, 1500);
    addEventListener('resize', update);
    return () => {
      clearInterval(id);
      removeEventListener('resize', update);
    };
  }, []);
  return clearance;
}

function useOnCallPage(anywhere: boolean): boolean {
  const [on, setOn] = useState(() => anywhere || isMeetCallPath(location.pathname));
  useEffect(() => {
    if (anywhere) return;
    const update = () => setOn(isMeetCallPath(location.pathname));
    const id = setInterval(update, 1000); // Meet navigates without reloads and fires no event we can rely on
    addEventListener('popstate', update);
    return () => {
      clearInterval(id);
      removeEventListener('popstate', update);
    };
  }, [anywhere]);
  return on;
}

export interface AudionAppProps {
  portalContainer?: HTMLElement | null;
  /** Show on every page of the host (dev pages such as fake-meet), not only on call URLs. */
  alwaysShow?: boolean;
  /** Injectable for tests; defaults to the app-wide store. */
  panelStore?: ReturnType<typeof getPanelStore>;
}

export function AudionApp({
  portalContainer,
  alwaysShow = false,
  panelStore = getPanelStore(),
}: AudionAppProps) {
  const settings = getSettingsStore();
  const usePanel = panelStore.useStore;
  const theme = settings.useStore((s) => s.settings.theme);
  const { expanded, enabled, position, drawer, ready } = usePanel();
  const { setExpanded, setEnabled, setPosition, openDrawer, closeDrawer } = usePanel.getState();

  useEffect(() => {
    void settings.init();
    void panelStore.init();
  }, [settings, panelStore]);

  const clearance = useBarClearance();
  const onCall = useOnCallPage(alwaysShow);
  const cardRef = useRef<HTMLElement>(null);
  const size = useCallback(() => {
    const r = cardRef.current?.getBoundingClientRect();
    return r && r.width ? { width: r.width, height: r.height } : CARD_FALLBACK;
  }, []);

  const base: Position = position ?? { right: 16, bottom: clearance };
  const [live, setLive] = useState<Position | null>(null); // position while dragging
  const shown = clampPosition(
    live ?? base,
    size(),
    { width: innerWidth, height: innerHeight },
    clearance,
  );

  const drag = useDrag({
    position: shown,
    size,
    minBottom: clearance,
    onMove: setLive,
    onCommit: (p) => {
      setPosition(p);
      setLive(null);
    },
  });

  if (!ready || !onCall) return null;

  const status: Status = enabled ? 'ready' : 'off';
  const toggle = (on: boolean) => setEnabled(on);

  return (
    <ThemeRoot theme={theme} portalContainer={portalContainer} className="ap-layer">
      {expanded ? (
        <PanelCard
          ref={cardRef}
          status={status}
          enabled={enabled}
          onToggle={toggle}
          onCollapse={() => setExpanded(false)}
          onOpenSettings={() => openDrawer('settings')}
          onOpenSigns={() => openDrawer('signs')}
          style={{ right: shown.right, bottom: shown.bottom }}
          dragHandlers={drag}
        />
      ) : (
        <Pill
          status={status}
          enabled={enabled}
          onToggle={toggle}
          onExpand={() => setExpanded(true)}
          style={{ right: EDGE_MARGIN * 2, bottom: clearance }}
        />
      )}
      <SettingsDrawer
        open={drawer === 'settings'}
        onOpenChange={(o) => (o ? openDrawer('settings') : closeDrawer())}
        onShowSigns={() => openDrawer('signs')}
      />
      <SignsSheet
        open={drawer === 'signs'}
        onOpenChange={(o) => (o ? openDrawer('signs') : closeDrawer())}
      />
    </ThemeRoot>
  );
}

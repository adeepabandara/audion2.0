import { ThemeRoot } from '@audion/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { locateControlBar, isMeetCallPath } from '../lib/meetDom';
import { getSettingsStore } from '../lib/settings';
import { pendingChip, viewOf } from './machine';
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
import type { AudionSession } from './session';
import { getPanelStore } from './store';
import { useDrag } from './useDrag';
import { useSessionState } from './useSession';

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
  session: AudionSession;
  portalContainer?: HTMLElement | null;
  /** Show on every page of the host (dev pages such as fake-meet), not only on call URLs. */
  alwaysShow?: boolean;
  /** Injectable for tests; defaults to the app-wide store. */
  panelStore?: ReturnType<typeof getPanelStore>;
}

export function AudionApp({
  session,
  portalContainer,
  alwaysShow = false,
  panelStore = getPanelStore(),
}: AudionAppProps) {
  const settings = getSettingsStore();
  const usePanel = panelStore.useStore;
  const theme = settings.useStore((s) => s.settings.theme);
  const { expanded, position, drawer, ready } = usePanel();
  const { setExpanded, setPosition, openDrawer, closeDrawer } = usePanel.getState();
  const machine = useSessionState(session);
  const view = viewOf(machine);

  useEffect(() => {
    void settings.init();
    void panelStore.init();
  }, [settings, panelStore]);

  // Things that need the signer's attention must not hide in the collapsed pill.
  const needsAttention = machine.problems.includes('cameraBlocked') || !!pendingChip(machine);
  useEffect(() => {
    if (needsAttention && ready && !expanded) setExpanded(true);
  }, [needsAttention, ready, expanded, setExpanded]);

  // Camera and tracker run only while Audion is On and the page is in use.
  useEffect(() => () => session.turnOff(), [session]);

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

  // Leaving the call page (SPA navigation) switches Audion off and releases the camera.
  useEffect(() => {
    if (!onCall) session.turnOff();
  }, [onCall, session]);

  if (!ready || !onCall) return null;

  const toggle = (on: boolean) => (on ? void session.turnOn() : session.turnOff());

  return (
    <ThemeRoot theme={theme} portalContainer={portalContainer} className="ap-layer">
      {/* Analysis source for the tracker and the light check; the visible preview is inside the card. */}
      <video
        ref={(el) => session.attachVideo(el)}
        className="ap-hidden-video"
        muted
        playsInline
        autoPlay
        aria-hidden="true"
      />
      {expanded ? (
        <PanelCard
          ref={cardRef}
          session={session}
          state={machine}
          view={view}
          onToggle={toggle}
          onCollapse={() => setExpanded(false)}
          onOpenSettings={() => openDrawer('settings')}
          onOpenSigns={() => openDrawer('signs')}
          style={{ right: shown.right, bottom: shown.bottom }}
          dragHandlers={drag}
        />
      ) : (
        <Pill
          status={view.status}
          label={view.label}
          enabled={machine.on}
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

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { defaultStore, type KeyValueStore } from '../lib/storage';
import { isPosition, type Position } from './position';

const KEY = 'panelPrefs';

export type Drawer = 'settings' | 'signs' | null;

export interface PanelState {
  /** Card (true) or collapsed pill (false). Remembered across page loads. */
  expanded: boolean;
  /** Audion On/Off. Deliberately not remembered: the camera only starts after an explicit action. */
  enabled: boolean;
  /** Where the user dragged the card; null = default spot above Meet's controls. Remembered. */
  position: Position | null;
  drawer: Drawer;
  ready: boolean;
  setExpanded(v: boolean): void;
  setEnabled(v: boolean): void;
  setPosition(p: Position | null): void;
  openDrawer(d: Exclude<Drawer, null>): void;
  closeDrawer(): void;
}

export type PanelStore = UseBoundStore<StoreApi<PanelState>>;

export function createPanelStore(backing: KeyValueStore = defaultStore('local')) {
  const persist = (s: PanelState) =>
    void backing.set(KEY, { expanded: s.expanded, position: s.position });

  const useStore = create<PanelState>((set, get) => ({
    expanded: false,
    enabled: false,
    position: null,
    drawer: null,
    ready: false,
    setExpanded: (expanded) => {
      set({ expanded });
      persist(get());
    },
    setEnabled: (enabled) => set({ enabled }),
    setPosition: (position) => {
      set({ position });
      persist(get());
    },
    openDrawer: (drawer) => set({ drawer }),
    closeDrawer: () => set({ drawer: null }),
  }));

  return {
    useStore,
    async init() {
      const raw = (await backing.get(KEY)) as
        | { expanded?: unknown; position?: unknown }
        | undefined;
      useStore.setState({
        expanded: raw?.expanded === true,
        position: isPosition(raw?.position) ? raw.position : null,
        ready: true,
      });
    },
  };
}

let shared: ReturnType<typeof createPanelStore> | undefined;
export function getPanelStore() {
  return (shared ??= createPanelStore());
}

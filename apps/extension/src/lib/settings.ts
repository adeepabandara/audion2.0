import { parseSettings, SETTINGS_DEFAULTS, type Settings } from '@audion/shared';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { defaultStore, type KeyValueStore } from './storage';

const KEY = 'settings';

export interface SettingsState {
  settings: Settings;
  /** False until the first read from storage completes. */
  ready: boolean;
  update(patch: Partial<Settings>): Promise<void>;
}

export type SettingsStore = UseBoundStore<StoreApi<SettingsState>>;

/** Zustand store backed by a KeyValueStore (chrome.storage.sync in the extension). Patches are re-validated. */
export function createSettingsStore(backing: KeyValueStore = defaultStore('sync')): {
  useStore: SettingsStore;
  init(): Promise<() => void>;
} {
  const useStore = create<SettingsState>((set, get) => ({
    settings: SETTINGS_DEFAULTS,
    ready: false,
    async update(patch) {
      const next = parseSettings({ ...get().settings, ...patch });
      set({ settings: next }); // optimistic: the UI never waits on storage
      await backing.set(KEY, next);
    },
  }));

  return {
    useStore,
    async init() {
      useStore.setState({ settings: parseSettings(await backing.get(KEY)), ready: true });
      return backing.subscribe(KEY, (v) => useStore.setState({ settings: parseSettings(v) }));
    },
  };
}

let shared: ReturnType<typeof createSettingsStore> | undefined;

/** App-wide singleton for extension pages and the content script. */
export function getSettingsStore() {
  return (shared ??= createSettingsStore());
}

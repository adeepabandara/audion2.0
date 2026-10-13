/**
 * Minimal key-value storage seam over chrome.storage areas. Real pages use chrome.storage; tests inject a Map
 * and plain-browser dev (no extension APIs, e.g. a static preview) falls back to localStorage.
 */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  /** Calls back when `key` changes elsewhere (other tab, other device via sync). */
  subscribe(key: string, cb: (value: unknown) => void): () => void;
}

export function chromeStore(area: 'sync' | 'local' | 'session'): KeyValueStore {
  const storage = () => chrome.storage[area];
  return {
    async get(key) {
      return (await storage().get(key))[key];
    },
    async set(key, value) {
      await storage().set({ [key]: value });
    },
    subscribe(key, cb) {
      const listener = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ) => {
        if (areaName === area && key in changes) cb(changes[key]?.newValue);
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };
}

export function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  const subs = new Map<string, Set<(v: unknown) => void>>();
  return {
    async get(key) {
      return data.get(key);
    },
    async set(key, value) {
      data.set(key, value);
      subs.get(key)?.forEach((cb) => cb(value));
    },
    subscribe(key, cb) {
      const set = subs.get(key) ?? new Set();
      set.add(cb);
      subs.set(key, set);
      return () => set.delete(cb);
    },
  };
}

export function localStorageStore(prefix = 'audion:'): KeyValueStore {
  const subs = new Map<string, Set<(v: unknown) => void>>();
  return {
    async get(key) {
      try {
        const raw = localStorage.getItem(prefix + key);
        return raw === null ? undefined : JSON.parse(raw);
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      try {
        localStorage.setItem(prefix + key, JSON.stringify(value));
      } catch {
        /* storage blocked: settings just won't persist in this preview */
      }
      subs.get(key)?.forEach((cb) => cb(value));
    },
    subscribe(key, cb) {
      const set = subs.get(key) ?? new Set();
      set.add(cb);
      subs.set(key, set);
      return () => set.delete(cb);
    },
  };
}

export function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.sync;
}

export function defaultStore(area: 'sync' | 'local'): KeyValueStore {
  return hasChromeStorage() ? chromeStore(area) : localStorageStore(`audion:${area}:`);
}

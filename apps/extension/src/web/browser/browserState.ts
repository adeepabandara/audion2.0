// What the simulated browser window is showing. The window is plain HTML on the demo page; this small store is the one
// place that says which "page" is open, whether Ola is installed and pinned, and whether the extensions menu is open.
// The tour changes it to walk a visitor through installing, pinning and joining; with no tour it is the finished state.
import { useSyncExternalStore } from 'react';

/** store = the extension's store page, join = the "ready to join?" screen, call = the meeting itself. */
export type Scene = 'store' | 'join' | 'call';

export interface BrowserState {
  scene: Scene;
  /** Ola has been added to the browser. */
  installed: boolean;
  /** Ola's icon is pinned to the toolbar. */
  pinned: boolean;
  /** The puzzle-piece (extensions) menu is open. */
  menuOpen: boolean;
  /** The store page has its own tab in the strip. */
  storeTab: boolean;
}

/** Everything done: Ola installed and pinned, in the call. This is the page without the tour. */
export const FINISHED: BrowserState = {
  scene: 'call',
  installed: true,
  pinned: true,
  menuOpen: false,
  storeTab: false,
};

/** Nothing done yet: the start of "show me from the start". */
export const FRESH: BrowserState = {
  scene: 'store',
  installed: false,
  pinned: false,
  menuOpen: false,
  storeTab: true,
};

let state: BrowserState = FINISHED;
const listeners = new Set<() => void>();

export const getBrowser = (): BrowserState => state;

export function setBrowser(patch: Partial<BrowserState>): void {
  const next = { ...state, ...patch };
  if ((Object.keys(next) as Array<keyof BrowserState>).every((k) => next[k] === state[k])) return;
  state = next;
  for (const l of [...listeners]) l();
}

export function subscribeBrowser(cb: (s: BrowserState) => void): () => void {
  const l = () => cb(state);
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useBrowser(): BrowserState {
  return useSyncExternalStore(
    (cb) => subscribeBrowser(cb),
    () => state,
  );
}

/** Back to the finished state (also used by tests). */
export const resetBrowser = (): void => setBrowser(FINISHED);

/** Show the state on the window's own element, so the page's CSS can react to it. */
export function bindBrowser(el: HTMLElement): () => void {
  const apply = (s: BrowserState) => {
    el.dataset.scene = s.scene;
    el.dataset.installed = s.installed ? '1' : '0';
    el.dataset.pinned = s.pinned ? '1' : '0';
    el.dataset.menu = s.menuOpen ? '1' : '0';
    el.dataset.storeTab = s.storeTab ? '1' : '0';
    document.getElementById('toolbar-puzzle')?.setAttribute('aria-expanded', String(s.menuOpen));
    const address = document.getElementById('omni-text');
    if (address)
      address.textContent =
        s.scene === 'store' ? 'store.ola-demo.example/ola-by-audion' : 'ola-demo.example/team-call';
  };
  apply(state);
  return subscribeBrowser(apply);
}

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore } from '../../panel/store';
import { memoryStore } from '../../lib/storage';
import { placePopover } from './Coach';
import { COACH_STEPS } from './steps';
import { Tour } from './Tour';

const VIEW = { w: 1000, h: 700 };
const SIZE = { w: 340, h: 200 };

describe('placePopover', () => {
  it('centres the popover when there is nothing to point at', () => {
    const p = placePopover(null, 'bottom', SIZE, VIEW);
    expect(p).toMatchObject({ left: 330, top: 250, side: 'center' });
  });

  it('puts it on the wanted side when it fits, and keeps it inside the window', () => {
    const target = { left: 100, top: 100, width: 100, height: 40 };
    const p = placePopover(target, 'bottom', SIZE, VIEW);
    expect(p.side).toBe('bottom');
    expect(p.top).toBeGreaterThan(140);
    expect(p.left).toBeGreaterThanOrEqual(12);
  });

  it('takes the side with room when the wanted one is too tight', () => {
    const target = { left: 400, top: 640, width: 100, height: 40 }; // near the bottom edge
    expect(placePopover(target, 'bottom', SIZE, VIEW).side).toBe('top');
    const atRight = { left: 940, top: 300, width: 50, height: 50 };
    expect(placePopover(atRight, 'right', SIZE, VIEW).side).not.toBe('right');
  });
});

describe('the guided steps', () => {
  it('has a plain title and body for every step, and the steps that wait say what to do', () => {
    for (const s of COACH_STEPS) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.body.length).toBeGreaterThan(20);
      if (s.waitFor) expect(s.hint).toBeTruthy();
    }
    expect(COACH_STEPS[0]!.id).toBe('join');
    expect(COACH_STEPS.at(-1)!.nextLabel).toBe('Finish');
  });
});

function fakeSession() {
  let state = { on: false, chips: [] as unknown[], sentence: null as string | null };
  const listeners = new Set<() => void>();
  return {
    session: {
      getState: () => state,
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    } as never,
    set(next: Partial<typeof state>) {
      state = { ...state, ...next };
      for (const l of listeners) l();
    },
  };
}

function mount(props: Partial<React.ComponentProps<typeof Tour>> = {}) {
  const panelStore = createPanelStore(memoryStore());
  const fake = fakeSession();
  const view = render(
    <Tour panelStore={panelStore} session={fake.session} shadow={document} {...props} />,
  );
  return { panelStore, fake, ...view };
}
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

/** Through the welcome, the (simulated) store page and the setup, to the first guided step. */
function toTheCall() {
  press('Try prototype');
  press('Add to Chrome');
  press('Add extension');
  tick(1500);
  press('Continue to setup');
  press('Not now');
  press('Skip, use the default voice');
  press('Join the call'); // setup
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  const toolbar = document.createElement('button');
  toolbar.id = 'toolbar-ola';
  toolbar.textContent = 'Ola';
  document.body.append(toolbar);
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the tour', () => {
  it('opens with a welcome over the prototype, and "Try prototype" shows the extension page', () => {
    mount();
    expect(screen.getByRole('dialog', { name: /Welcome to Ola/ })).toBeTruthy();
    press('Try prototype');
    const store = screen.getByRole('dialog', { name: /Ola by Audion, extension page/ });
    expect(store).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ola by Audion' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add to Chrome' })).toBeTruthy();
    // It says it is a simulation, and shows no invented ratings or user numbers.
    expect(screen.getByText(/simulation inside the Ola demo/)).toBeTruthy();
    expect(screen.queryByText(/users|ratings|reviews/i)).toBeNull();
  });

  it('can be skipped, and then only offers a small "Take the tour" button, which starts it again', () => {
    mount();
    press('Explore on my own');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('ola:tour')).toBe('skipped');
    press('Take the tour');
    expect(screen.getByRole('dialog', { name: /Welcome to Ola/ })).toBeTruthy();
  });

  it('does not start again for someone who has seen it, and never starts when disabled', () => {
    localStorage.setItem('ola:tour', 'done');
    const first = mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Take the tour' })).toBeTruthy();
    first.unmount();
    mount({ force: true });
    expect(screen.getByRole('dialog', { name: /Welcome to Ola/ })).toBeTruthy();
    document.body.innerHTML = '';
    mount({ disabled: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Take the tour' })).toBeNull();
  });

  it('asks before adding the extension, and Cancel goes back', () => {
    mount();
    press('Try prototype');
    press('Add to Chrome');
    expect(screen.getByRole('alertdialog', { name: /Add “Ola by Audion”/ })).toBeTruthy();
    press('Cancel');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add to Chrome' })).toBeTruthy();
  });

  it('walks through install, camera, voice and ready, each skippable, then joins the call', () => {
    mount();
    press('Try prototype');
    press('Add to Chrome');
    press('Add extension');
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeTruthy();
    tick(1500);
    expect(screen.getByText(/was added/)).toBeTruthy();
    press('Continue to setup');
    expect(screen.getByRole('heading', { name: 'Allow your camera' })).toBeTruthy();
    press('Not now');
    expect(screen.getByRole('heading', { name: 'Choose your voice' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'How should your voice sound?' })).toBeTruthy();
    press('Skip, use the default voice');
    expect(screen.getByRole('heading', { name: 'You’re ready' })).toBeTruthy();
    press('Join the call');
    expect(screen.getByRole('dialog', { name: /about to join a team call/ })).toBeTruthy();
  });

  it('guides the steps in order, and "Back" and "Skip tour" work', () => {
    mount();
    toTheCall();
    press('Join the call'); // the first guided step
    expect(screen.getByRole('heading', { name: 'Open Ola' })).toBeTruthy();
    expect(screen.getByText('Step 2 of 9')).toBeTruthy();
    press('Back');
    expect(screen.getByRole('heading', { name: /about to join/ })).toBeTruthy();
    press('Join the call');
    press('Skip tour');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('ola:tour')).toBe('skipped');
  });

  it('moves on by itself when the visitor opens Ola, turns it on and signs', () => {
    const { panelStore, fake } = mount();
    toTheCall();
    press('Join the call');
    expect(screen.getByRole('heading', { name: 'Open Ola' })).toBeTruthy();

    act(() => panelStore.useStore.getState().setExpanded(true));
    expect(screen.getByRole('status').textContent).toBe('Nice, that worked.');
    tick(1000);
    expect(screen.getByRole('heading', { name: 'Turn Ola on' })).toBeTruthy();

    act(() => fake.set({ on: true }));
    tick(1000);
    expect(screen.getByRole('heading', { name: 'Sign to the camera' })).toBeTruthy();

    act(() => fake.set({ chips: [{ sign: 'hello' }] }));
    tick(1000);
    expect(screen.getByRole('heading', { name: 'Your signs become a sentence' })).toBeTruthy();
  });

  it('skips a waiting step at once when the visitor has already done it', () => {
    const { panelStore } = mount();
    act(() => panelStore.useStore.getState().setExpanded(true));
    toTheCall();
    press('Join the call');
    tick(1000);
    expect(screen.getByRole('heading', { name: 'Turn Ola on' })).toBeTruthy(); // the panel was already open
  });

  it('can always be moved past, and Finish ends the tour as done', () => {
    mount();
    toTheCall();
    press('Join the call');
    for (let i = 1; i < COACH_STEPS.length - 1; i++) press(/^(Next|Skip step)$/);
    expect(screen.getByRole('heading', { name: /really happening/ })).toBeTruthy();
    press('Finish');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('ola:tour')).toBe('done');
  });

  it('closes with Escape', () => {
    mount();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

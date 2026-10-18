import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GemmaStatus } from './gemmaComposer';
import { GemmaNotice } from './GemmaNotice';

function fakeGemma(start: GemmaStatus) {
  let status = start;
  const subs = new Set<(s: GemmaStatus) => void>();
  const g = {
    status: () => status,
    subscribe: (cb: (s: GemmaStatus) => void) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    disable: vi.fn(() => g.set({ state: 'off' })),
    set(s: GemmaStatus) {
      status = s;
      subs.forEach((cb) => cb(s));
    },
  };
  return g;
}

afterEach(cleanup);

describe('GemmaNotice', () => {
  it('shows nothing until the download starts, then its progress and a Stop button', () => {
    const g = fakeGemma({ state: 'off' });
    const { container } = render(<GemmaNotice gemma={g} sizeGb={2} onStop={() => {}} />);
    expect(container.textContent).toBe('');
    act(() => g.set({ state: 'loading', progress: 0.34 }));
    expect(screen.getByRole('status').textContent).toMatch(/about 2 GB.*34%/);
    expect(screen.getByRole('button', { name: 'Stop download' })).toBeTruthy();
  });

  it('Stop turns Gemma off, remembers it, and says Gemini writes the sentences', () => {
    const g = fakeGemma({ state: 'loading', progress: null });
    const onStop = vi.fn();
    render(<GemmaNotice gemma={g} sizeGb={2} onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop download' }));
    expect(g.disable).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toMatch(/stopped.*Gemini/);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('goes away by itself once the model is ready, or when it cannot run', () => {
    const g = fakeGemma({ state: 'loading', progress: 0.9 });
    const { container } = render(<GemmaNotice gemma={g} sizeGb={2} onStop={() => {}} />);
    act(() => g.set({ state: 'ready' }));
    expect(container.textContent).toBe('');
    act(() => g.set({ state: 'unsupported', reason: 'No WebGPU.' }));
    expect(container.textContent).toBe('');
  });
});

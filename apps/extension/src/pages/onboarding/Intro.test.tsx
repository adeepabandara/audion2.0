import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeRoot } from '@audion/ui';
import { INTRO_MS, Intro } from './Intro';

const wrap = (onDone: () => void) =>
  render(
    <ThemeRoot theme="dark">
      <Intro onDone={onDone} />
    </ThemeRoot>,
  );

describe('Intro', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the logo and finishes after 3 seconds', () => {
    const onDone = vi.fn();
    wrap(onDone);
    expect(screen.getByRole('img', { name: 'Ola by Audion' })).toBeTruthy();
    act(() => void vi.advanceTimersByTime(INTRO_MS - 1));
    expect(onDone).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('can be skipped with the button, a click, or any key', () => {
    const onDone = vi.fn();
    wrap(onDone);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDone).toHaveBeenCalled();
  });

  it('stops its timer when removed', () => {
    const onDone = vi.fn();
    const { unmount } = wrap(onDone);
    unmount();
    act(() => void vi.advanceTimersByTime(INTRO_MS * 2));
    expect(onDone).not.toHaveBeenCalled();
  });
});

import { Wordmark } from '@audion/ui';
import { useEffect } from 'react';

export const INTRO_MS = 3000;

/**
 * Full-screen logo shown for 3 seconds when the welcome page first loads. Click, Escape or any key skips it.
 * Callers should not render it when the user prefers reduced motion (see OnboardingApp).
 */
export function Intro({ onDone }: { onDone(): void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, INTRO_MS);
    const skip = () => onDone();
    window.addEventListener('keydown', skip);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', skip);
    };
  }, [onDone]);

  return (
    <div className="ob-intro" onClick={onDone}>
      <Wordmark animate />
      <button type="button" className="ob-intro__skip" onClick={onDone}>
        Skip
      </button>
    </div>
  );
}

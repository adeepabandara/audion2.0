import { useState } from 'react';
import { GestureList } from './Gestures';
import { PRACTICE_SENTENCES } from './steps';

/**
 * "Try these sentences": five everyday sentences, one shown at a time, each with the signs to make in order and every sign
 * acted out by its hand picture. It opens when the tour reaches the signing step and STAYS until the visitor closes it (the
 * tour itself ends after the first sentence, but people keep trying), and a small "Signs to try" button brings it back.
 */
export function SignGuide({ open, onClose }: { open: boolean; onClose(): void }) {
  const [picked, setPicked] = useState(0);
  if (!open) return null;
  const sentence = PRACTICE_SENTENCES[picked]!;
  return (
    <aside
      className="sign-guide"
      aria-labelledby="sign-guide-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <header className="sign-guide__head">
        <h2 id="sign-guide-title">Try these sentences</h2>
        <button
          type="button"
          className="sign-guide__close"
          aria-label="Close the sign guide"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>
      <ol className="sign-guide__pick" aria-label="Sentences">
        {PRACTICE_SENTENCES.map((s, i) => (
          <li key={s.says}>
            <button
              type="button"
              aria-pressed={i === picked}
              aria-label={`Sentence ${i + 1}: ${s.says}`}
              onClick={() => setPicked(i)}
            >
              {i + 1}
            </button>
          </li>
        ))}
      </ol>
      <p className="sign-guide__says" aria-live="polite">
        “{sentence.says}”
      </p>
      <p>Sign these in order, one at a time, then pause.</p>
      <GestureList signs={sentence.signs} label={`Signs for: ${sentence.says}`} />
      <p className="sign-guide__note">Ola may word it a little differently.</p>
    </aside>
  );
}

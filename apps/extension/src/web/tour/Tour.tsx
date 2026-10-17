import '@audion/ui/styles.css';
import { Wordmark } from '@audion/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudionSession } from '../../panel/session';
import type { PanelStore } from '../../panel/store';
import { Coach } from './Coach';
import { SetupFlow } from './SetupFlow';
import { COACH_STEPS } from './steps';
import { StorePage } from './StorePage';
import './tour.css';

/**
 * The quick tour for the demo: a welcome, the (simulated) extension page, a short setup, then guided steps in the
 * call that point at the real widget and wait for the visitor to try each thing.
 */
type Stage = 'idle' | 'welcome' | 'store' | 'setup' | 'coach';

const KEY = 'ola:tour';
const remember = (v: string) => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* storage blocked: the tour just starts again next time */
  }
};
const seen = () => {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
};

export interface TourProps {
  panelStore: { useStore: PanelStore };
  session: Pick<AudionSession, 'getState' | 'subscribe'>;
  /** Ola's widget lives in a shadow root; its parts are looked up there. */
  shadow: ParentNode;
  /** Start the tour whether or not it has been seen (a visit with ?tour=1). */
  force?: boolean;
  /** Never show it (a visit with ?tour=0). */
  disabled?: boolean;
}

export function Tour({ panelStore, session, shadow, force = false, disabled = false }: TourProps) {
  const [stage, setStage] = useState<Stage>(() =>
    disabled ? 'idle' : force || !seen() ? 'welcome' : 'idle',
  );
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const welcomeButton = useRef<HTMLButtonElement>(null);

  const finish = useCallback((how: 'done' | 'skipped') => {
    remember(how);
    setStage('idle');
  }, []);
  const start = () => {
    setIndex(0);
    setDone(false);
    setStage('welcome');
  };

  useEffect(() => {
    if (stage === 'welcome') welcomeButton.current?.focus();
  }, [stage]);

  // The page is covered while the tour owns the screen.
  useEffect(() => {
    document.body.classList.toggle('tour-open', stage !== 'idle');
    return () => document.body.classList.remove('tour-open');
  }, [stage]);

  const find = useCallback(
    (selector: string): HTMLElement | null =>
      document.querySelector<HTMLElement>(selector) ?? shadow.querySelector<HTMLElement>(selector),
    [shadow],
  );

  const step = COACH_STEPS[index]!;
  const next = useCallback(() => {
    setDone(false);
    if (index >= COACH_STEPS.length - 1) finish('done');
    else setIndex((i) => i + 1);
  }, [index, finish]);

  // Steps that wait for the visitor: move on a moment after they have done the thing (or at once if already done).
  useEffect(() => {
    if (stage !== 'coach' || !step.waitFor) return;
    const met = () => {
      if (step.waitFor === 'panel-open') return panelStore.useStore.getState().expanded;
      const s = session.getState();
      if (step.waitFor === 'ola-on') return s.on;
      return s.chips.length > 0 || s.sentence !== null;
    };
    let timer: number | undefined;
    const check = () => {
      if (timer === undefined && met()) {
        setDone(true);
        timer = window.setTimeout(next, 900);
      }
    };
    check();
    const offPanel = panelStore.useStore.subscribe(check);
    const offSession = session.subscribe(check);
    return () => {
      offPanel();
      offSession();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [stage, step, panelStore, session, next]);

  return (
    <>
      {stage === 'welcome' && (
        <div className="tour-backdrop">
          <div
            className="tour-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tour-welcome"
            onKeyDown={(e) => {
              if (e.key === 'Escape') finish('skipped');
            }}
          >
            <Wordmark size={44} />
            <h1 id="tour-welcome">Welcome to Ola</h1>
            <p>
              Ola gives Deaf and hard-of-hearing signers a voice in video calls. Sign to your
              camera, and Ola speaks for you, in a voice you choose.
            </p>
            <p className="tour-modal__sub">
              A two-minute guided tour. You can skip it at any time.
            </p>
            <div className="tour-modal__actions">
              <button
                ref={welcomeButton}
                type="button"
                className="tour-btn tour-btn--lg"
                onClick={() => setStage('store')}
              >
                Try prototype
              </button>
              <button
                type="button"
                className="tour-btn tour-btn--ghost"
                onClick={() => finish('skipped')}
              >
                Explore on my own
              </button>
            </div>
          </div>
        </div>
      )}

      {stage === 'store' && (
        <StorePage onAdded={() => setStage('setup')} onClose={() => finish('skipped')} />
      )}

      {stage === 'setup' && (
        <SetupFlow
          onDone={() => {
            setIndex(0);
            setStage('coach');
          }}
          onSkip={() => finish('skipped')}
        />
      )}

      {stage === 'coach' && (
        <Coach
          step={step}
          index={index}
          total={COACH_STEPS.length}
          find={find}
          done={done}
          onNext={next}
          onBack={() => setIndex((i) => Math.max(0, i - 1))}
          onSkip={() => finish('skipped')}
        />
      )}

      {stage === 'idle' && !disabled && (
        <button type="button" className="tour-launch" onClick={start}>
          Take the tour
        </button>
      )}
    </>
  );
}

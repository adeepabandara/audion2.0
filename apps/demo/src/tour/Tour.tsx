import '@audion/ui/styles.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AudionSession } from '@ext/panel/session';
import type { PanelStore } from '@ext/panel/store';
import {
  FINISHED,
  FRESH,
  getBrowser,
  setBrowser,
  subscribeBrowser,
  useBrowser,
} from '../browser/browserState';
import { Coach } from './Coach';
import { SignGuide } from './SignGuide';
import { COACH_STEPS, type Wait } from './steps';
import { StorePage } from './StorePage';
import './tour.css';

/**
 * The quick tour for the demo. It follows what a signer does, in three chapters: install the extension (add it from the
 * store, pin it), join a meeting (Ola appears by itself), and use Ola (open it, turn it on, camera ready, sign, hear the
 * sentence). The browser window on the page changes with it, and each step zooms in on the thing it points at.
 */
type Stage = 'idle' | 'welcome' | 'coach';

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
  const [stuck, setStuck] = useState<string | undefined>();
  /** The "Try these signs" guide: it opens at the signing step and stays until the visitor closes it. */
  const [guideOpen, setGuideOpen] = useState(false);
  const startButton = useRef<HTMLButtonElement>(null);
  const browser = useBrowser();

  /** The window ends in its finished state, so what is left on the page is the working demo. */
  const finish = useCallback((how: 'done' | 'skipped') => {
    remember(how);
    setBrowser(FINISHED);
    setStage('idle');
  }, []);
  const welcome = () => {
    setIndex(0);
    setDone(false);
    setStage('welcome');
  };
  /** Nothing installed yet, on the store page: the tour starts where a new user would. */
  const begin = () => {
    setDone(false);
    setStuck(undefined);
    setBrowser(FRESH);
    setIndex(0);
    setStage('coach');
  };

  useEffect(() => {
    if (stage === 'welcome') startButton.current?.focus();
  }, [stage]);

  // The page is covered while the tour owns the screen.
  useEffect(() => {
    document.body.classList.toggle('tour-open', stage !== 'idle');
    return () => document.body.classList.remove('tour-open');
  }, [stage]);

  const find = useCallback(
    (selectors: string | string[]): HTMLElement | null => {
      for (const q of Array.isArray(selectors) ? selectors : [selectors]) {
        const el = document.querySelector<HTMLElement>(q) ?? shadow.querySelector<HTMLElement>(q);
        if (el) return el;
      }
      return null;
    },
    [shadow],
  );

  const step = COACH_STEPS[index]!;

  useEffect(() => {
    if (stage === 'coach' && step.guide) setGuideOpen(true);
  }, [stage, step]);

  // A new step starts fresh: nothing is "done" or in the way yet. (This runs before the step's own check below.)
  useEffect(() => {
    setDone(false);
    setStuck(undefined);
  }, [index]);

  // The browser window shows the page this step happens on.
  useEffect(() => {
    if (stage === 'coach') setBrowser({ scene: step.scene });
  }, [stage, step]);

  const next = useCallback(() => {
    setDone(false);
    setStuck(undefined);
    // Passing a step by that the visitor did not do leaves things as if they had, so the next step still makes sense.
    if (step.waitFor === 'installed') setBrowser({ installed: true });
    if (step.waitFor === 'pinned') setBrowser({ installed: true, pinned: true, menuOpen: false });
    // Leaving the voice questions closes Settings again, so the next step sees the camera and the sentence.
    if (step.id === 'voice-pick') find('.au-drawer .au-drawer__head button')?.click();
    if (index >= COACH_STEPS.length - 1) finish('done');
    else setIndex((i) => i + 1);
  }, [index, step, finish, find]);

  // Steps that wait for the visitor: move on a moment after they have done the thing (or at once if already done).
  useEffect(() => {
    if (stage !== 'coach' || !step.waitFor) return;
    const wanted: Wait = step.waitFor;
    const met = () => {
      const b = getBrowser();
      const s = session.getState();
      switch (wanted) {
        case 'installed':
          return b.installed;
        case 'pinned':
          return b.pinned;
        case 'joined':
          return b.scene === 'call';
        case 'panel-open':
          return panelStore.useStore.getState().expanded;
        case 'ola-on':
          return s.on;
        case 'ready':
          return s.on && !s.starting && !s.problems.includes('cameraBlocked');
        case 'settings-open':
          return find('.au-drawer') !== null;
        case 'voice-setup':
          return find('.au-drawer .vs') !== null;
        case 'voice-saved':
          return seenSetup && find('.au-drawer .vs') === null;
        case 'sentence':
          return s.sentence !== null || s.speaking;
        case 'spoken':
          return voiceHeard || (sawSpeaking && !s.speaking);
      }
    };
    // "Ola has said it": the voice started and then ended. If that is missed (a short sentence can finish before this
    // step shows) or never happens (no sound), the step moves on after a few seconds instead of waiting forever.
    let seenSetup = false;
    let sawSpeaking = false;
    let voiceHeard = false;
    const giveUp =
      wanted === 'spoken'
        ? window.setTimeout(() => {
            voiceHeard = true;
            check();
          }, 7000)
        : undefined;
    let timer: number | undefined;
    const check = () => {
      if (session.getState().speaking) sawSpeaking = true;
      if (find('.au-drawer .vs')) seenSetup = true;
      const blocked =
        (wanted === 'ola-on' || wanted === 'ready') &&
        session.getState().problems.includes('cameraBlocked');
      setStuck(
        blocked
          ? 'The camera is blocked. Allow it in your browser, then choose Try again in Ola.'
          : undefined,
      );
      if (timer === undefined && met()) {
        setDone(true);
        timer = window.setTimeout(next, 900);
      }
    };
    check();
    const offPanel = panelStore.useStore.subscribe(check);
    const offSession = session.subscribe(check);
    // The browser window's own state (installed, pinned, joined) is part of what some steps wait for.
    const offBrowser = subscribeBrowser(check);
    // Settings and the voice questions are drawn by the widget itself, so watch the widget for them.
    const watch = new MutationObserver(check);
    if (wanted.startsWith('voice') || wanted === 'settings-open')
      watch.observe(shadow, { childList: true, subtree: true });
    return () => {
      offPanel();
      offSession();
      offBrowser();
      watch.disconnect();
      if (timer !== undefined) window.clearTimeout(timer);
      if (giveUp !== undefined) window.clearTimeout(giveUp);
    };
  }, [stage, step, panelStore, session, next, find, shadow]);

  const storeRoot = stage === 'coach' ? document.getElementById('scene-store') : null;

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
            <img
              src="/icon/128.png"
              alt="Ola"
              width={72}
              height={72}
              className="tour-modal__icon"
            />
            <h1 id="tour-welcome">Welcome to Ola</h1>
            <p>
              Ola is a browser extension that gives signers a voice in video calls. See how it works
              in about a minute.
            </p>
            <button
              ref={startButton}
              type="button"
              className="tour-btn tour-btn--lg"
              onClick={begin}
            >
              Start the tour
            </button>
            <button type="button" className="tour-link" onClick={() => finish('skipped')}>
              Explore on my own
            </button>
          </div>
        </div>
      )}

      {/* The extension's store page is a tab inside the browser window. */}
      {storeRoot &&
        browser.storeTab &&
        createPortal(<StorePage onAdded={() => setBrowser({ installed: true })} />, storeRoot)}

      {stage === 'coach' && (
        <Coach
          step={step}
          index={index}
          total={COACH_STEPS.length}
          find={find}
          done={done}
          stuck={stuck}
          onNext={next}
          onSkip={() => finish('skipped')}
        />
      )}

      {/* Not part of the tour: it is still there after it ends, until the visitor closes it. */}
      {!disabled && <SignGuide open={guideOpen} onClose={() => setGuideOpen(false)} />}

      {stage === 'idle' && !disabled && (
        <div className="tour-launchers">
          <button type="button" className="tour-launch" onClick={welcome}>
            Take the tour
          </button>
          {!guideOpen && (
            <button type="button" className="tour-launch" onClick={() => setGuideOpen(true)}>
              Signs to try
            </button>
          )}
        </div>
      )}
    </>
  );
}

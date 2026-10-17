import { useEffect, useRef, useState } from 'react';

/**
 * A page laid out like an extension store listing: name, publisher, an add button, tabs, screenshots, an overview, a
 * privacy section and a details panel. It is a SIMULATION for this demo (it says so on the page) with Ola's own
 * styling and no store branding. Everything on it is true of the prototype: there are no ratings, review counts or
 * user numbers, because none exist.
 */

export const SHOTS = [
  { src: '/store/shot-1.png', alt: 'Ola open in a video call, ready to turn on' },
  {
    src: '/store/shot-2.png',
    alt: 'Voice setup: five questions, then hear, see and check the voice',
  },
  { src: '/store/shot-3.png', alt: 'Settings: translate to another language, choose a voice' },
  { src: '/store/shot-4.png', alt: 'The signs Ola understands, as small pictures' },
  {
    src: '/store/shot-5.png',
    alt: 'Behind the scenes: live data flowing through Gemini, Gemma and Google Cloud',
  },
];

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'privacy', label: 'Privacy practices' },
  { id: 'details', label: 'Details' },
];

type Phase = 'browse' | 'confirm' | 'adding' | 'added';

export interface StorePageProps {
  onAdded(): void;
  onClose(): void;
}

export function StorePage({ onAdded, onClose }: StorePageProps) {
  const [phase, setPhase] = useState<Phase>('browse');
  const [shot, setShot] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);

  useEffect(() => root.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    if (phase === 'confirm') confirmButton.current?.focus();
    if (phase === 'adding') {
      const t = window.setTimeout(() => setPhase('added'), 1400);
      return () => window.clearTimeout(t);
    }
    if (phase === 'added') continueButton.current?.focus();
  }, [phase]);

  const go = (id: string) =>
    document.getElementById(`store-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const step = (d: number) => setShot((s) => (s + d + SHOTS.length) % SHOTS.length);

  return (
    <div
      className="store"
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Ola by Audion, extension page"
      onKeyDown={(e) => {
        if (e.key === 'Escape') (phase === 'confirm' ? () => setPhase('browse') : onClose)();
      }}
    >
      <header className="store__bar">
        <span className="store__bar-title">Extensions</span>
        <input
          className="store__search"
          disabled
          placeholder="Search extensions"
          aria-label="Search (not available in the demo)"
        />
        <button type="button" className="tour-btn tour-btn--ghost" onClick={onClose}>
          Skip to the demo
        </button>
      </header>

      {phase === 'added' && (
        <div className="store__added" role="status">
          <span>
            <strong>Ola by Audion</strong> was added.
          </span>
          <button ref={continueButton} type="button" className="tour-btn" onClick={onAdded}>
            Continue to setup
          </button>
        </div>
      )}

      <main className="store__main">
        <section className="store__hero" aria-labelledby="store-name">
          <img src="/icon/128.png" alt="" width={128} height={128} className="store__icon" />
          <div className="store__hero-text">
            <h1 id="store-name">Ola by Audion</h1>
            <p className="store__meta">
              Offered by Audion · Accessibility · <span className="store__badge">Prototype</span>
            </p>
            <p className="store__summary">
              Sign to your camera in a video call. Ola turns your signs into a spoken voice, in the
              voice you choose.
            </p>
            <button
              type="button"
              className="tour-btn tour-btn--lg"
              onClick={() => setPhase('confirm')}
              disabled={phase !== 'browse'}
            >
              {phase === 'added'
                ? 'Added to Chrome'
                : phase === 'adding'
                  ? 'Adding…'
                  : 'Add to Chrome'}
            </button>
            {phase === 'adding' && (
              <div className="store__progress" aria-hidden="true">
                <span />
              </div>
            )}
          </div>
        </section>

        <nav className="store__tabs" aria-label="Sections of this page">
          {TABS.map((t) => (
            <button key={t.id} type="button" className="store__tab" onClick={() => go(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>

        <section
          className="store__gallery"
          aria-roledescription="carousel"
          aria-label="Screenshots"
        >
          <button
            type="button"
            className="store__arrow"
            onClick={() => step(-1)}
            aria-label="Previous screenshot"
          >
            ‹
          </button>
          <figure className="store__shot">
            <img src={SHOTS[shot]!.src} alt={SHOTS[shot]!.alt} />
            <figcaption className="au-sr-only" aria-live="polite">
              Screenshot {shot + 1} of {SHOTS.length}
            </figcaption>
          </figure>
          <button
            type="button"
            className="store__arrow"
            onClick={() => step(1)}
            aria-label="Next screenshot"
          >
            ›
          </button>
          <div className="store__dots">
            {SHOTS.map((s, i) => (
              <button
                key={s.src}
                type="button"
                className={`store__dot${i === shot ? ' store__dot--on' : ''}`}
                onClick={() => setShot(i)}
                aria-label={`Screenshot ${i + 1}`}
                aria-current={i === shot}
              />
            ))}
          </div>
        </section>

        <div className="store__cols">
          <div>
            <section id="store-overview" aria-labelledby="h-overview">
              <h2 id="h-overview">Overview</h2>
              <p>
                Ola gives Deaf and hard-of-hearing people who sign American Sign Language a voice in
                video calls. Turn it on, sign to your camera, and Ola:
              </p>
              <ul>
                <li>recognises your signs on your own device (a set of common signs, growing),</li>
                <li>joins them into one natural sentence with Gemma or Gemini,</li>
                <li>
                  speaks it in a voice you set up with a few questions, in the language you pick.
                </li>
              </ul>
              <p>
                Voice setup lets you hear, see and check how your voice sounds to others: a
                plain-words description, the shape of the sound, and what Google Speech-to-Text
                hears. Every control works with the keyboard, and motion respects your settings.
              </p>
            </section>

            <section id="store-privacy" aria-labelledby="h-privacy">
              <h2 id="h-privacy">Privacy practices</h2>
              <ul>
                <li>
                  Your video is processed on your device to recognise signs, and is never stored.
                </li>
                <li>
                  The sentences you sign are sent to Google Cloud only to be written, translated and
                  spoken. They are not stored or logged.
                </li>
                <li>
                  Meeting context is off until you turn it on. Captions are summarised in memory and
                  forgotten when Ola turns off.
                </li>
              </ul>
              <h3>Permissions</h3>
              <ul>
                <li>
                  Read and change data on the video-call site, to show Ola in the call and add its
                  voice.
                </li>
                <li>Store its settings (voice, language, caption options).</li>
              </ul>
            </section>
          </div>

          <aside id="store-details" className="store__details" aria-labelledby="h-details">
            <h2 id="h-details">Details</h2>
            <dl>
              <dt>Version</dt>
              <dd>0.1.0 (prototype)</dd>
              <dt>Updated</dt>
              <dd>October 2026</dd>
              <dt>Category</dt>
              <dd>Accessibility</dd>
              <dt>Languages</dt>
              <dd>English, with translation into 8 languages</dd>
              <dt>Developer</dt>
              <dd>Audion</dd>
            </dl>
            <p className="store__fine">
              This page is a simulation inside the Ola demo. In real use, Ola is added to Chrome
              from its store page.
            </p>
          </aside>
        </div>
      </main>

      {phase === 'confirm' && (
        <div className="store__veil">
          <div
            className="store__confirm"
            role="alertdialog"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-body"
          >
            <h2 id="confirm-title">Add “Ola by Audion”?</h2>
            <div id="confirm-body">
              <p>It can:</p>
              <ul>
                <li>Read and change your data on the video-call site</li>
                <li>Store its own settings</li>
              </ul>
            </div>
            <div className="store__confirm-actions">
              <button
                type="button"
                className="tour-btn tour-btn--ghost"
                onClick={() => setPhase('browse')}
              >
                Cancel
              </button>
              <button
                ref={confirmButton}
                type="button"
                className="tour-btn"
                onClick={() => setPhase('adding')}
              >
                Add extension
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

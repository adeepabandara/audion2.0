import { Banner, Icon, ThemeRoot, Wordmark } from '@audion/ui';
import { useEffect, useRef, useState } from 'react';
import { VoiceSetup } from '../../components/VoiceSetup';

type Camera = 'idle' | 'asking' | 'allowed' | 'blocked';

const STEPS = ['Camera', 'Voice', 'Ready'];

export interface SetupFlowProps {
  onDone(): void;
  onSkip(): void;
}

/** The quick setup: allow the camera, set up a voice, then join the call. Each step can be skipped. */
export function SetupFlow({ onDone, onSkip }: SetupFlowProps) {
  const [step, setStep] = useState(0);
  const [camera, setCamera] = useState<Camera>('idle');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), [step]);

  async function allowCamera() {
    setCamera('asking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      for (const t of stream.getTracks()) t.stop(); // only asking: Ola opens the camera itself when it is turned on
      setCamera('allowed');
    } catch {
      setCamera('blocked');
    }
  }

  return (
    <ThemeRoot theme="system">
      <div
        className="tour-setup"
        role="dialog"
        aria-modal="true"
        aria-label="Set up Ola"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onSkip();
        }}
      >
        <div className="tour-setup__card">
          <div className="tour-setup__top">
            <Wordmark size={34} />
            <ol className="tour-setup__steps" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
              {STEPS.map((s, i) => (
                <li
                  key={s}
                  className={i === step ? 'is-on' : i < step ? 'is-done' : ''}
                  aria-current={i === step}
                >
                  <span className="tour-setup__n">
                    {i < step ? <Icon name="check" size={12} /> : i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
            <button type="button" className="tour-btn tour-btn--ghost" onClick={onSkip}>
              Skip setup
            </button>
          </div>

          {step === 0 && (
            <section>
              <h1 ref={heading} tabIndex={-1}>
                Allow your camera
              </h1>
              <p>
                Ola uses your camera to see your signs. Hand tracking runs on your device, and your
                video is never stored. Your browser will ask for permission.
              </p>
              {camera === 'allowed' && <Banner tone="info">Camera allowed.</Banner>}
              {camera === 'blocked' && (
                <Banner tone="warning">
                  Camera blocked. You can still look around, but Ola won’t see your signs until you
                  allow it in your browser.
                </Banner>
              )}
              <div className="tour-setup__actions">
                <button
                  type="button"
                  className="tour-btn tour-btn--lg"
                  onClick={() => (camera === 'allowed' ? setStep(1) : void allowCamera())}
                  disabled={camera === 'asking'}
                >
                  {camera === 'allowed'
                    ? 'Continue'
                    : camera === 'asking'
                      ? 'Waiting for your browser…'
                      : 'Allow camera'}
                </button>
                {camera !== 'allowed' && (
                  <button
                    type="button"
                    className="tour-btn tour-btn--ghost"
                    onClick={() => setStep(1)}
                  >
                    {camera === 'blocked' ? 'Continue anyway' : 'Not now'}
                  </button>
                )}
              </div>
            </section>
          )}

          {step === 1 && (
            <section>
              <h1 ref={heading} tabIndex={-1}>
                Choose your voice
              </h1>
              <p>
                Answer a few questions. You’ll hear each voice, see its sound and check what others
                will hear.
              </p>
              <VoiceSetup onSaved={() => setStep(2)} />
              <div className="tour-setup__actions">
                <button
                  type="button"
                  className="tour-btn tour-btn--ghost"
                  onClick={() => setStep(2)}
                >
                  Skip, use the default voice
                </button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section>
              <h1 ref={heading} tabIndex={-1}>
                You’re ready
              </h1>
              <p>Next, join the team call and we’ll show you how to use Ola, one step at a time.</p>
              <div className="tour-setup__actions">
                <button type="button" className="tour-btn tour-btn--lg" onClick={onDone}>
                  Join the call
                </button>
                <button
                  type="button"
                  className="tour-btn tour-btn--ghost"
                  onClick={() => setStep(1)}
                >
                  Back
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </ThemeRoot>
  );
}

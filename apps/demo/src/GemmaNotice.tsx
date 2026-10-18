import { useEffect, useState } from 'react';
import type { Gemma, GemmaStatus } from './gemmaComposer';
import './gemmaNotice.css';

/**
 * While the 2 GB Gemma model downloads (it starts when a visitor first turns Ola on), a small card says so and offers
 * to stop it. Stopping is remembered, so it does not start again on the next visit; Gemini keeps writing the sentences.
 * Nothing shows once the model is ready, when the browser cannot run it, or after a stop has been acknowledged.
 */
export function GemmaNotice({
  gemma,
  sizeGb,
  onStop,
}: {
  gemma: Pick<Gemma, 'status' | 'subscribe' | 'disable'>;
  sizeGb: number;
  /** Remember the choice (the page stores it). */
  onStop(): void;
}) {
  const [status, setStatus] = useState<GemmaStatus>(gemma.status());
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    const off = gemma.subscribe(setStatus);
    return () => void off();
  }, [gemma]);

  if (stopped) {
    return (
      <div className="gemma-notice" role="status">
        <p>Download stopped. Gemini on Google Cloud writes your sentences.</p>
        <button type="button" className="gemma-notice__btn" onClick={() => setStopped(false)}>
          OK
        </button>
      </div>
    );
  }
  if (status.state !== 'loading') return null;
  const pct = status.progress === null ? null : Math.round(status.progress * 100);
  return (
    <div className="gemma-notice" role="status" aria-live="polite">
      <p>
        Getting Gemma for on-device sentences (about {sizeGb} GB, once)
        {pct === null ? '' : `: ${pct}%`}. Gemini writes them meanwhile.
      </p>
      {pct !== null && (
        <span className="gemma-notice__bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      <button
        type="button"
        className="gemma-notice__btn"
        onClick={() => {
          gemma.disable();
          onStop();
          setStopped(true);
        }}
      >
        Stop download
      </button>
    </div>
  );
}

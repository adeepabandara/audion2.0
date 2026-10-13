import { Banner, Button, Chip, StatusPill } from '@audion/ui';
import { useEffect, useRef, useState } from 'react';
import {
  CAMERA_CONSTRAINTS,
  classifyMediaError,
  lightingFrom,
  recordClip,
  sampleVideoLuminance,
  type CameraProblem,
  type Lighting,
} from '../../lib/camera';
import { send, toBase64 } from '../../lib/messages';

type Phase = 'idle' | 'countdown' | 'recording' | 'checking' | 'success' | 'retry' | 'error';

const CAMERA_TEXT: Record<CameraProblem, string> = {
  blocked:
    'Camera blocked. Allow camera access for Audion in Chrome’s address bar, then reload this page.',
  busy: 'Your camera is in use by another app. Close it and reload this page.',
  missing: 'No camera found. Plug one in and reload this page.',
  unknown: 'Couldn’t start the camera. Reload this page and try again.',
};

/** Body-and-hands outline to help framing. */
function Guide() {
  return (
    <svg
      className="ob__guide"
      viewBox="0 0 400 300"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeDasharray="8 8"
      aria-hidden="true"
    >
      <circle cx="200" cy="95" r="42" />
      <path d="M95 300c0-62 46-100 105-100s105 38 105 100" />
      <circle cx="105" cy="210" r="26" />
      <circle cx="295" cy="210" r="26" />
    </svg>
  );
}

export interface CalibrationProps {
  /** Called once the person has signed "hello" successfully. */
  onPassed(passed: boolean): void;
}

export function Calibration({ onPassed }: CalibrationProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [lighting, setLighting] = useState<Lighting>('ok');
  const [phase, setPhase] = useState<Phase>('idle');
  const [count, setCount] = useState(3);
  const [seen, setSeen] = useState<string | null>(null);
  const [mockMode, setMockMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia(CAMERA_CONSTRAINTS)
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraReady(true);
        setCameraReady(true);
      })
      .catch((e) => !cancelled && setProblem(classifyMediaError(e)));
    void send({ type: 'api/health' }).then(
      (h) => !cancelled && h.ok && setMockMode(h.mode === 'mock'),
    );
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const mean = videoRef.current ? sampleVideoLuminance(videoRef.current) : null;
      if (mean !== null) setLighting(lightingFrom(mean));
    }, 500);
    return () => clearInterval(id);
  }, []);

  async function attempt() {
    const stream = streamRef.current;
    if (!stream) return;
    setSeen(null);
    setPhase('countdown');
    for (let n = 3; n >= 1; n--) {
      setCount(n);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setPhase('recording');
    try {
      const clip = await recordClip(stream, 2500);
      setPhase('checking');
      const res = await send({
        type: 'api/recognize',
        clipBase64: toBase64(await clip.blob.arrayBuffer()),
        mime: clip.mime,
        durationMs: clip.durationMs,
      });
      if (!res.ok) {
        setSeen(null);
        setPhase('error');
        return;
      }
      setSeen(res.sign);
      // Mock mode returns scripted signs, so only the camera/lighting/upload path is being verified there.
      const passed = res.sign === 'hello' || mockMode;
      setPhase(passed ? 'success' : 'retry');
      onPassed(passed);
    } catch {
      setPhase('error');
    }
  }

  const busy = phase === 'countdown' || phase === 'recording' || phase === 'checking';

  return (
    <div className="ob__stack">
      <h2>Check your camera</h2>
      {problem ? (
        <Banner tone="error">{CAMERA_TEXT[problem]}</Banner>
      ) : (
        <>
          <div className={`ob__preview${phase === 'success' ? ' ob__preview--success' : ''}`}>
            <video ref={videoRef} autoPlay muted playsInline aria-label="Your camera preview" />
            <Guide />
            {phase === 'countdown' && (
              <div className="ob__count" aria-hidden="true">
                {count}
              </div>
            )}
          </div>
          <div className="ob__actions">
            <StatusPill
              status={lighting === 'ok' ? 'ready' : 'attention'}
              label={lighting === 'ok' ? 'Lighting looks good' : 'Move to a brighter spot'}
            />
            {phase === 'success' && <Chip state="confirmed">hello</Chip>}
          </div>
          <p className="ob__prompt" role="status" aria-live="polite">
            {phase === 'idle' && 'Sign “hello” when you press Start.'}
            {phase === 'countdown' && `Get ready… ${count}`}
            {phase === 'recording' && 'Sign “hello” now'}
            {phase === 'checking' && 'Checking…'}
            {phase === 'success' &&
              (mockMode && seen !== 'hello'
                ? `Camera works. (Test mode: recognition is scripted and saw “${seen}”.)`
                : 'That’s “hello”. You’re ready.')}
            {phase === 'retry' && `We saw “${seen}”. Try again, a bit slower.`}
            {phase === 'error' && 'We couldn’t check that sign.'}
          </p>
          {phase === 'error' && (
            <Banner tone="error">
              Can’t reach the Audion service. Check that it is running, then try again.
            </Banner>
          )}
          {phase === 'retry' && (
            <Banner tone="warning">Keep your hands in the outline and sign slowly.</Banner>
          )}
          <Button
            onClick={() => void attempt()}
            disabled={busy || !cameraReady}
            variant={phase === 'success' ? 'secondary' : 'primary'}
          >
            {!cameraReady
              ? 'Starting camera…'
              : phase === 'idle'
                ? 'Start'
                : phase === 'success'
                  ? 'Try again'
                  : busy
                    ? 'Working…'
                    : 'Try again'}
          </Button>
        </>
      )}
    </div>
  );
}

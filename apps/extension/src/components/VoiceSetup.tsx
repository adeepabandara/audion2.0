import { Banner, Button, Icon, Segmented, Slider } from '@audion/ui';
import {
  describeProfile,
  getVoice,
  heightWord,
  MAX_PITCH,
  MAX_SPEED,
  MIN_PITCH,
  MIN_SPEED,
  paceWord,
  pitchPosition,
  recommendProfiles,
  voiceHeight,
  type VoiceAnswers,
  type VoiceProfile,
} from '@audion/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { compareHeard, type HeardResult } from '../lib/heard';
import { playAudio, type Playback } from '../lib/audioPlayer';
import { fromBase64, send } from '../lib/messages';
import { getSettingsStore } from '../lib/settings';
import { SAMPLE_LINE } from './VoicePicker';
import { ShareVoice } from './ShareVoice';
import { VoiceVisual } from './VoiceVisual';

const QUESTIONS: Array<{
  key: keyof VoiceAnswers;
  label: string;
  options: Array<{ value: string; label: string }>;
}> = [
  {
    key: 'sound',
    label: 'How should your voice sound?',
    options: [
      { value: 'feminine', label: 'Feminine' },
      { value: 'masculine', label: 'Masculine' },
      { value: 'neutral', label: 'In between' },
    ],
  },
  {
    key: 'age',
    label: 'How old should it feel?',
    options: [
      { value: 'young', label: 'Younger' },
      { value: 'adult', label: 'Adult' },
      { value: 'mature', label: 'Mature' },
    ],
  },
  {
    key: 'pace',
    label: 'How fast do you like to talk?',
    options: [
      { value: 'calm', label: 'Calm' },
      { value: 'natural', label: 'Natural' },
      { value: 'brisk', label: 'Brisk' },
    ],
  },
  {
    key: 'tone',
    label: 'What tone suits you?',
    options: [
      { value: 'warm', label: 'Warm' },
      { value: 'crisp', label: 'Crisp' },
      { value: 'deep', label: 'Deep' },
    ],
  },
  {
    key: 'accent',
    label: 'Which English accent?',
    options: [
      { value: 'us', label: 'American' },
      { value: 'uk', label: 'British' },
      { value: 'in', label: 'Indian' },
      { value: 'au', label: 'Australian' },
    ],
  },
];

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type Check =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'done'; heard: string; mode: 'google' | 'mock'; result: HeardResult }
  | { state: 'error'; message: string };

export interface VoiceSetupProps {
  /** Called after the voice has been saved. */
  onSaved?(): void;
}

/**
 * Voice setup: five questions give three suggested voices; each can be heard, seen (the shape of the sound, the
 * caption in time with it, how deep or high it is), described in plain words and checked with Google
 * Speech-to-Text ("People will hear: ..."), so a signer who cannot hear can still choose their voice with confidence.
 */
export function VoiceSetup({ onSaved }: VoiceSetupProps) {
  const { useStore } = getSettingsStore();
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.update);

  const [answers, setAnswers] = useState<VoiceAnswers>(() => {
    const v = getVoice(settings.voiceId);
    return {
      sound: v?.gender === 'male' ? 'masculine' : 'feminine',
      age: 'adult',
      pace: 'natural',
      tone: 'warm',
      accent: v?.accent ?? 'us',
    };
  });
  const suggestions = useMemo(() => recommendProfiles(answers), [answers]);
  const [index, setIndex] = useState(0);
  const [tweak, setTweak] = useState<Partial<Pick<VoiceProfile, 'pitch' | 'speed'>>>({});
  const profile: VoiceProfile = { ...(suggestions[index] ?? suggestions[0]!), ...tweak };
  const portrait = describeProfile(profile);

  const [playing, setPlaying] = useState(false);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [saved, setSaved] = useState(false);
  const [sharing, setSharing] = useState(false);
  const playback = useRef<Playback | null>(null);
  const raf = useRef(0);

  useEffect(
    () => () => {
      playback.current?.stop();
      cancelAnimationFrame(raf.current);
    },
    [],
  );

  const changed = () => {
    setCheck({ state: 'idle' });
    setSaved(false);
  };
  const ask = <K extends keyof VoiceAnswers>(key: K, value: string) => {
    setAnswers((a) => ({ ...a, [key]: value }) as VoiceAnswers);
    setIndex(0);
    setTweak({});
    changed();
  };

  async function play() {
    if (playing) {
      playback.current?.stop();
      return;
    }
    setError(null);
    const res = await send({
      type: 'api/speak',
      text: SAMPLE_LINE,
      voiceId: profile.voiceId,
      speed: profile.speed,
      ...(profile.pitch ? { pitch: profile.pitch } : {}),
    });
    if (!res.ok) {
      setError(res.error.code === 'NETWORK' ? 'Can’t reach Ola. Try again.' : res.error.message);
      return;
    }
    try {
      const pb = await playAudio(fromBase64(res.audioBase64));
      playback.current = pb;
      setPeaks(pb.peaks);
      setProgress(0);
      setPlaying(true);
      if (!reducedMotion()) {
        const tick = () => {
          setProgress(pb.duration ? pb.elapsed() / pb.duration : 0);
          raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
      }
      await pb.done;
    } catch {
      setError('Couldn’t play that on this device.');
    } finally {
      cancelAnimationFrame(raf.current);
      setPlaying(false);
      setProgress(1);
    }
  }

  async function runCheck() {
    setCheck({ state: 'checking' });
    const res = await send({
      type: 'api/voiceCheck',
      text: SAMPLE_LINE,
      voiceId: profile.voiceId,
      speed: profile.speed,
      ...(profile.pitch ? { pitch: profile.pitch } : {}),
    });
    if (!res.ok) {
      return setCheck({
        state: 'error',
        message:
          res.error.code === 'NETWORK' ? 'Can’t reach Ola. Try again.' : 'Check unavailable.',
      });
    }
    setCheck({
      state: 'done',
      heard: res.heard,
      mode: res.mode,
      result: compareHeard(SAMPLE_LINE, res.heard),
    });
  }

  async function save() {
    await update({
      voiceId: profile.voiceId,
      pitch: profile.pitch,
      speed: profile.speed,
      voiceSetupDone: true,
    });
    setSaved(true);
    onSaved?.();
  }

  const voice = getVoice(profile.voiceId);
  return (
    <div className="vs">
      {QUESTIONS.map((q) => (
        <div key={q.key} className="vs__q">
          <span className="vs__q-label" id={`vs-${q.key}`}>
            {q.label}
          </span>
          <Segmented
            label={q.label}
            value={answers[q.key]}
            options={q.options.map((o) => ({ value: o.value, label: o.label }))}
            onValueChange={(v) => ask(q.key, v)}
          />
        </div>
      ))}

      <div className="vs__cands" role="radiogroup" aria-label="Suggested voices">
        {suggestions.map((s, i) => (
          <label key={s.voiceId} className={`vs__cand${i === index ? ' vs__cand--on' : ''}`}>
            <input
              type="radio"
              name="vs-voice"
              checked={i === index}
              onChange={() => {
                setIndex(i);
                setTweak({});
                changed();
              }}
            />
            <span className="vs__cand-name">{getVoice(s.voiceId)?.label}</span>
          </label>
        ))}
      </div>

      <p className="vs__portrait">
        <strong>{voice?.label}.</strong> {portrait}
      </p>

      <VoiceVisual
        peaks={peaks}
        progress={progress}
        text={SAMPLE_LINE}
        pitchPosition={pitchPosition(profile)}
        portrait={portrait}
        playing={playing}
      />

      <div className="vs__row">
        <Button variant="secondary" icon={playing ? 'pause' : 'play'} onClick={() => void play()}>
          {playing ? 'Stop' : 'Hear it'}
        </Button>
        <Button variant="secondary" icon="share" onClick={() => setSharing(true)}>
          Ask someone to listen
        </Button>
        <Button
          variant="secondary"
          icon="check-circle"
          onClick={() => void runCheck()}
          disabled={check.state === 'checking'}
        >
          {check.state === 'checking' ? 'Checking…' : 'What will people hear?'}
        </Button>
      </div>
      {error && <Banner tone="error">{error}</Banner>}

      <div aria-live="polite" className="vs__check">
        {check.state === 'done' && (
          <>
            {check.mode === 'mock' ? (
              <Banner tone="info">Test mode: nothing was really checked.</Banner>
            ) : (
              <Banner tone={check.result.level === 'clear' ? 'info' : 'warning'}>
                {check.result.level === 'clear'
                  ? 'Clear: every word was understood.'
                  : check.result.level === 'mostly'
                    ? `Mostly clear. Missed: ${check.result.missed.join(', ')}.`
                    : 'Unclear. Try a calmer pace or another voice.'}
              </Banner>
            )}
            <p className="vs__heard">
              <Icon name="eye" size={14} /> People will hear: “{check.heard || 'nothing'}”
            </p>
          </>
        )}
        {check.state === 'error' && <Banner tone="error">{check.message}</Banner>}
      </div>

      <details className="vs__tune">
        <summary>Fine-tune</summary>
        <Slider
          label="Higher or lower"
          min={MIN_PITCH}
          max={MAX_PITCH}
          step={0.5}
          value={profile.pitch}
          onValueChange={(pitch) => {
            setTweak((t) => ({ ...t, pitch }));
            changed();
          }}
          format={(p) => heightWord(voiceHeight({ ...profile, pitch: p }))}
        />
        <Slider
          label="Speaking pace"
          min={MIN_SPEED}
          max={MAX_SPEED}
          step={0.05}
          value={profile.speed}
          onValueChange={(speed) => {
            setTweak((t) => ({ ...t, speed: Math.round(speed * 100) / 100 }));
            changed();
          }}
          format={paceWord}
        />
      </details>

      <div className="vs__row">
        <Button onClick={() => void save()}>Use this voice</Button>
        {saved && (
          <span className="vs__saved" role="status">
            <Icon name="check" size={16} /> Saved as your voice.
          </span>
        )}
      </div>
      <ShareVoice
        open={sharing}
        onOpenChange={setSharing}
        profile={profile}
        onProfileChange={(p) => {
          setTweak({ pitch: p.pitch, speed: p.speed });
          changed();
        }}
        onAnotherVoice={() => {
          setIndex((i) => (i + 1) % Math.max(1, suggestions.length));
          setTweak({});
          changed();
        }}
      />
    </div>
  );
}

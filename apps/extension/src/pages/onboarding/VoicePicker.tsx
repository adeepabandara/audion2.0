import { Banner, Slider, VoiceCard } from '@audion/ui';
import { MAX_SPEED, MIN_SPEED, VOICES, type VoiceId } from '@audion/shared';
import { useEffect, useRef, useState } from 'react';
import { playAudio, type Playback } from '../../lib/audioPlayer';
import { fromBase64, send } from '../../lib/messages';
import { getSettingsStore } from '../../lib/settings';

const DESCRIPTIONS: Record<VoiceId, string> = {
  aria: 'Warm, female, US English',
  nora: 'Bright, female, US English',
  david: 'Calm, male, US English',
  miles: 'Deep, male, US English',
};
export const SAMPLE_LINE = 'Hello, I’m signing with Audion. Please wait a moment.';

export function VoicePicker() {
  const { useStore } = getSettingsStore();
  const { voiceId, speed } = useStore((s) => s.settings);
  const update = useStore((s) => s.update);
  const [playing, setPlaying] = useState<VoiceId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Playback | null>(null);

  useEffect(() => () => current.current?.stop(), []);

  async function play(id: VoiceId) {
    current.current?.stop();
    if (playing === id) return setPlaying(null);
    setError(null);
    setPlaying(id);
    const res = await send({ type: 'api/speak', text: SAMPLE_LINE, voiceId: id, speed });
    if (!res.ok) {
      setPlaying(null);
      return setError(
        res.error.code === 'NETWORK'
          ? 'Can’t reach the Audion service. Check that it is running and try again.'
          : res.error.message,
      );
    }
    try {
      const pb = await playAudio(fromBase64(res.audioBase64));
      current.current = pb;
      await pb.done;
    } catch {
      setError('Couldn’t play that sample on this device.');
    } finally {
      setPlaying((p) => (p === id ? null : p));
    }
  }

  return (
    <div className="ob__stack">
      <h2>Pick your voice</h2>
      {error && <Banner tone="error">{error}</Banner>}
      <div className="ob__voices" role="radiogroup" aria-label="Voice">
        {VOICES.map((v) => (
          <VoiceCard
            key={v.id}
            groupName="voice"
            name={v.label}
            description={DESCRIPTIONS[v.id]}
            selected={voiceId === v.id}
            playing={playing === v.id}
            onSelect={() => void update({ voiceId: v.id })}
            onPlay={() => void play(v.id)}
          />
        ))}
      </div>
      <Slider
        label="Speaking speed"
        min={MIN_SPEED}
        max={MAX_SPEED}
        step={0.05}
        value={speed}
        onValueChange={(v) => void update({ speed: Math.round(v * 100) / 100 })}
        format={(x) => `${x.toFixed(2)}×`}
      />
    </div>
  );
}

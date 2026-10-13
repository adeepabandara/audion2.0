import { describe, expect, it } from 'vitest';
import { FakeStream, FakeTrack, makeFakeContext } from '../testing/fakeAudio';
import { Mixer } from './audioMixer';

const bytes = () => new ArrayBuffer(8);
const mic = () => new FakeStream([new FakeTrack('audio')]) as unknown as MediaStream;

describe('Mixer routing', () => {
  it('wires real mic and Audion voice into one bus that feeds the outgoing track and a level probe', async () => {
    const { ctx, edges } = makeFakeContext();
    const mixer = new Mixer(ctx, mic());
    await mixer.play(bytes());
    expect(edges).toEqual(
      expect.arrayContaining([
        ['micGain', 'bus'],
        ['voiceGain', 'bus'],
        ['bus', 'dest'],
        ['bus', 'analyser'],
        ['micSource', 'micGain'],
        ['voice', 'voiceGain'],
      ]),
    );
    expect(mixer.hasMic).toBe(true);
    expect(mixer.stream.getAudioTracks()).toHaveLength(1);
  });

  it('still provides an audio track when there is no microphone', async () => {
    const { ctx, edges } = makeFakeContext();
    const mixer = new Mixer(ctx, null);
    expect(mixer.hasMic).toBe(false);
    expect(edges.find(([a]) => a === 'micSource')).toBeUndefined();
    expect(await mixer.play(bytes())).toBe('done');
  });

  it('plays only while enabled and unmuted, and resumes a suspended context', async () => {
    const { ctx, gains } = makeFakeContext();
    const mixer = new Mixer(ctx, mic());
    mixer.configure({ enabled: false });
    expect(await mixer.play(bytes())).toBe('disabled');
    expect(ctx.played).toBe(0);

    mixer.configure({ enabled: true, voiceMuted: true });
    expect(await mixer.play(bytes())).toBe('muted');
    expect(gains.voiceGain!.value).toBe(0);

    mixer.configure({ voiceMuted: false });
    ctx.state = 'suspended';
    expect(await mixer.play(bytes())).toBe('done');
    expect(ctx.resumed).toBe(1);
    expect(ctx.played).toBe(1);
    expect(gains.voiceGain!.value).toBe(1);
  });

  it('never touches the real microphone gain: the signer can still speak', () => {
    const { ctx, gains } = makeFakeContext();
    const mixer = new Mixer(ctx, mic());
    mixer.configure({ enabled: false, voiceMuted: true });
    expect(gains.micGain!.value).toBe(1);
    mixer.dispose();
    expect(ctx.closed).toBe(true);
  });

  it('reports the level of the mixed output', () => {
    const { ctx, analyserData } = makeFakeContext();
    const mixer = new Mixer(ctx, mic());
    expect(mixer.peak()).toBe(0);
    analyserData.fill = 192; // 64 above the 128 midpoint
    expect(mixer.peak()).toBeCloseTo(0.5);
  });
});

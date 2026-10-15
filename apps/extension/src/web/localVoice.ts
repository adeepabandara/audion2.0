import { playAudio } from '../lib/audioPlayer';
import type { Probe, VoiceChannel } from '../lib/voiceBridge';
import type { SpeakResult } from '../lib/voiceProtocol';

/**
 * The web demo has no Meet call, so there is no call channel: Ola's voice just plays on the visitor's speakers.
 * `speak` resolves when the sentence has finished playing.
 */
export class LocalVoice implements VoiceChannel {
  async speak(audio: Uint8Array): Promise<SpeakResult> {
    try {
      const playback = await playAudio(audio);
      await playback.done;
      return 'done';
    } catch {
      return 'error';
    }
  }
  configure(): void {}
  onChannel(): () => void {
    return () => {};
  }
  onDelivery(): () => void {
    return () => {};
  }
  async probe(): Promise<Probe> {
    return { hasChannel: false, micMuted: false, peak: 0 };
  }
  dispose(): void {}
}

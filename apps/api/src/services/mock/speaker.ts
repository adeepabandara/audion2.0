import type { SpeakRequest } from '@audion/shared';
import type { Speaker } from '../types.js';

const SAMPLE_RATE = 16_000;
const BASE_HZ: Record<string, number> = { aria: 330, nora: 280, david: 150, miles: 190 };

/**
 * Mock speaker: a short synthetic two-tone WAV whose length follows the text and speed.
 * Content type is audio/wav (not audio/mpeg); the extension decodes with decodeAudioData, which sniffs the format.
 */
export class MockSpeaker implements Speaker {
  async speak({ text, voiceId, speed }: SpeakRequest) {
    const seconds = Math.min(4, Math.max(0.6, (text.length * 0.06) / speed));
    const n = Math.floor(seconds * SAMPLE_RATE);
    const hz = BASE_HZ[voiceId] ?? 220;
    const pcm = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE;
      const fade = Math.min(1, t / 0.03, (seconds - t) / 0.05);
      const wobble = 1 + 0.08 * Math.sin(2 * Math.PI * 4 * t);
      const v =
        (Math.sin(2 * Math.PI * hz * wobble * t) + 0.4 * Math.sin(2 * Math.PI * hz * 2 * t)) / 1.4;
      pcm.writeInt16LE(Math.round(v * fade * 0.4 * 32767), i * 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return { audio: Buffer.concat([header, pcm]), contentType: 'audio/wav' };
  }
}

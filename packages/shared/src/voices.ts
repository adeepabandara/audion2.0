export interface VoiceOption {
  id: string;
  label: string;
  gender: 'female' | 'male';
  /** Cloud Text-to-Speech voice name (en-US). Verify availability in M1 before relying on it. */
  ttsName: string;
  languageCode: 'en-US';
}

export const VOICES = [
  {
    id: 'aria',
    label: 'Aria',
    gender: 'female',
    ttsName: 'en-US-Neural2-F',
    languageCode: 'en-US',
  },
  {
    id: 'nora',
    label: 'Nora',
    gender: 'female',
    ttsName: 'en-US-Neural2-C',
    languageCode: 'en-US',
  },
  {
    id: 'david',
    label: 'David',
    gender: 'male',
    ttsName: 'en-US-Neural2-D',
    languageCode: 'en-US',
  },
  {
    id: 'miles',
    label: 'Miles',
    gender: 'male',
    ttsName: 'en-US-Neural2-J',
    languageCode: 'en-US',
  },
] as const satisfies readonly VoiceOption[];

export type VoiceId = (typeof VOICES)[number]['id'];

export const VOICE_IDS = VOICES.map((v) => v.id) as [VoiceId, ...VoiceId[]];

export function getVoice(id: string): VoiceOption | undefined {
  return VOICES.find((v) => v.id === id);
}

export type Accent = 'us' | 'uk' | 'in' | 'au';

export const ACCENTS = [
  { id: 'us', label: 'American', languageCode: 'en-US' },
  { id: 'uk', label: 'British', languageCode: 'en-GB' },
  { id: 'in', label: 'Indian', languageCode: 'en-IN' },
  { id: 'au', label: 'Australian', languageCode: 'en-AU' },
] as const satisfies readonly { id: Accent; label: string; languageCode: string }[];

export interface VoiceOption {
  id: string;
  label: string;
  gender: 'female' | 'male';
  accent: Accent;
  /** Cloud Text-to-Speech voice name. All are Neural2 voices: they accept a pitch change (Chirp 3 HD voices do not). */
  ttsName: string;
  languageCode: 'en-US' | 'en-GB' | 'en-IN' | 'en-AU';
}

/**
 * The voice bank. Every name was checked against Google's voice list on 2026-10-15 (`listVoices`, genders match).
 * The first four are the original Ola voices. Google gives no description of how a voice sounds, so none is claimed
 * here: the setup flow describes the voice by what it can measure (gender, accent, pitch change, pace).
 */
export const VOICES = [
  {
    id: 'aria',
    label: 'Aria',
    gender: 'female',
    accent: 'us',
    ttsName: 'en-US-Neural2-F',
    languageCode: 'en-US',
  },
  {
    id: 'nora',
    label: 'Nora',
    gender: 'female',
    accent: 'us',
    ttsName: 'en-US-Neural2-C',
    languageCode: 'en-US',
  },
  {
    id: 'ivy',
    label: 'Ivy',
    gender: 'female',
    accent: 'us',
    ttsName: 'en-US-Neural2-E',
    languageCode: 'en-US',
  },
  {
    id: 'maya',
    label: 'Maya',
    gender: 'female',
    accent: 'us',
    ttsName: 'en-US-Neural2-G',
    languageCode: 'en-US',
  },
  {
    id: 'june',
    label: 'June',
    gender: 'female',
    accent: 'us',
    ttsName: 'en-US-Neural2-H',
    languageCode: 'en-US',
  },
  {
    id: 'david',
    label: 'David',
    gender: 'male',
    accent: 'us',
    ttsName: 'en-US-Neural2-D',
    languageCode: 'en-US',
  },
  {
    id: 'miles',
    label: 'Miles',
    gender: 'male',
    accent: 'us',
    ttsName: 'en-US-Neural2-J',
    languageCode: 'en-US',
  },
  {
    id: 'eli',
    label: 'Eli',
    gender: 'male',
    accent: 'us',
    ttsName: 'en-US-Neural2-A',
    languageCode: 'en-US',
  },
  {
    id: 'owen',
    label: 'Owen',
    gender: 'male',
    accent: 'us',
    ttsName: 'en-US-Neural2-I',
    languageCode: 'en-US',
  },
  {
    id: 'clara',
    label: 'Clara',
    gender: 'female',
    accent: 'uk',
    ttsName: 'en-GB-Neural2-A',
    languageCode: 'en-GB',
  },
  {
    id: 'edith',
    label: 'Edith',
    gender: 'female',
    accent: 'uk',
    ttsName: 'en-GB-Neural2-C',
    languageCode: 'en-GB',
  },
  {
    id: 'freya',
    label: 'Freya',
    gender: 'female',
    accent: 'uk',
    ttsName: 'en-GB-Neural2-F',
    languageCode: 'en-GB',
  },
  {
    id: 'nina',
    label: 'Nina',
    gender: 'female',
    accent: 'uk',
    ttsName: 'en-GB-Neural2-N',
    languageCode: 'en-GB',
  },
  {
    id: 'arthur',
    label: 'Arthur',
    gender: 'male',
    accent: 'uk',
    ttsName: 'en-GB-Neural2-B',
    languageCode: 'en-GB',
  },
  {
    id: 'henry',
    label: 'Henry',
    gender: 'male',
    accent: 'uk',
    ttsName: 'en-GB-Neural2-D',
    languageCode: 'en-GB',
  },
  {
    id: 'oscar',
    label: 'Oscar',
    gender: 'male',
    accent: 'uk',
    ttsName: 'en-GB-Neural2-O',
    languageCode: 'en-GB',
  },
  {
    id: 'asha',
    label: 'Asha',
    gender: 'female',
    accent: 'in',
    ttsName: 'en-IN-Neural2-A',
    languageCode: 'en-IN',
  },
  {
    id: 'diya',
    label: 'Diya',
    gender: 'female',
    accent: 'in',
    ttsName: 'en-IN-Neural2-D',
    languageCode: 'en-IN',
  },
  {
    id: 'arjun',
    label: 'Arjun',
    gender: 'male',
    accent: 'in',
    ttsName: 'en-IN-Neural2-B',
    languageCode: 'en-IN',
  },
  {
    id: 'rohan',
    label: 'Rohan',
    gender: 'male',
    accent: 'in',
    ttsName: 'en-IN-Neural2-C',
    languageCode: 'en-IN',
  },
  {
    id: 'ruby',
    label: 'Ruby',
    gender: 'female',
    accent: 'au',
    ttsName: 'en-AU-Neural2-A',
    languageCode: 'en-AU',
  },
  {
    id: 'chloe',
    label: 'Chloe',
    gender: 'female',
    accent: 'au',
    ttsName: 'en-AU-Neural2-C',
    languageCode: 'en-AU',
  },
  {
    id: 'jack',
    label: 'Jack',
    gender: 'male',
    accent: 'au',
    ttsName: 'en-AU-Neural2-B',
    languageCode: 'en-AU',
  },
  {
    id: 'liam',
    label: 'Liam',
    gender: 'male',
    accent: 'au',
    ttsName: 'en-AU-Neural2-D',
    languageCode: 'en-AU',
  },
] as const satisfies readonly VoiceOption[];

export type VoiceId = (typeof VOICES)[number]['id'];

export const VOICE_IDS = VOICES.map((v) => v.id) as [VoiceId, ...VoiceId[]];

export function getVoice(id: string): VoiceOption | undefined {
  return VOICES.find((v) => v.id === id);
}

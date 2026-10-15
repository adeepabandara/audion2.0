/**
 * Languages Ola can translate a sentence into (live translation). The code is what the API and settings use; `tts`
 * is the Cloud Text-to-Speech language code the spoken translation is requested with (the voice is picked by
 * Google from that code and the chosen voice's gender, so no voice names have to be kept here).
 */
export interface Language {
  code: string;
  /** The language's own name, so a speaker of it can find it. */
  label: string;
  /** English name, used in the prompt. */
  english: string;
  tts: string;
}

export const LANGUAGES = [
  { code: 'en', label: 'English', english: 'English', tts: 'en-US' },
  { code: 'es', label: 'Español', english: 'Spanish', tts: 'es-ES' },
  { code: 'fr', label: 'Français', english: 'French', tts: 'fr-FR' },
  { code: 'de', label: 'Deutsch', english: 'German', tts: 'de-DE' },
  { code: 'pt', label: 'Português', english: 'Brazilian Portuguese', tts: 'pt-BR' },
  { code: 'hi', label: 'हिन्दी', english: 'Hindi', tts: 'hi-IN' },
  { code: 'ja', label: '日本語', english: 'Japanese', tts: 'ja-JP' },
  { code: 'zh', label: '中文', english: 'Mandarin Chinese', tts: 'cmn-CN' },
  { code: 'ar', label: 'العربية', english: 'Arabic', tts: 'ar-XA' },
] as const satisfies readonly Language[];

export type LanguageCode = (typeof LANGUAGES)[number]['code'];
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]];
export const TRANSLATE_CODES = LANGUAGE_CODES.filter((c) => c !== 'en') as [
  Exclude<LanguageCode, 'en'>,
  ...Exclude<LanguageCode, 'en'>[],
];

export function getLanguage(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

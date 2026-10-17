import { LANGUAGES, type LanguageCode } from '@audion/shared';
import type { FlagCode, LanguageOption } from '@audion/ui';

/** The languages for the flag menu: its own name, a flag, and the English name (or "No translation") underneath. */
export const LANGUAGE_OPTIONS: LanguageOption[] = LANGUAGES.map((l) => ({
  value: l.code,
  label: l.label,
  flag: l.code as FlagCode,
  hint: l.code === 'en' ? 'No translation' : l.english,
}));

export const languageLabel = (code: LanguageCode): string =>
  LANGUAGES.find((l) => l.code === code)?.label ?? code;

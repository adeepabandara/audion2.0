import type { TranslateRequest } from '@audion/shared';
import type { Translator } from '../types.js';

/** A few phrases so the demo in test mode looks right; anything else gets a visible "(test)" marker, never a fake translation. */
const PHRASES: Record<string, Record<string, string>> = {
  'Hello.': {
    es: 'Hola.',
    fr: 'Bonjour.',
    de: 'Hallo.',
    pt: 'Olá.',
    hi: 'नमस्ते।',
    ja: 'こんにちは。',
    zh: '你好。',
    ar: 'مرحبا.',
  },
  'Thank you.': {
    es: 'Gracias.',
    fr: 'Merci.',
    de: 'Danke.',
    pt: 'Obrigado.',
    hi: 'धन्यवाद।',
    ja: 'ありがとう。',
    zh: '谢谢。',
    ar: 'شكرا.',
  },
  'Bye.': {
    es: 'Adiós.',
    fr: 'Au revoir.',
    de: 'Tschüss.',
    pt: 'Tchau.',
    hi: 'अलविदा।',
    ja: 'さようなら。',
    zh: '再见。',
    ar: 'وداعا.',
  },
};

/** MOCK=1: no model. Known phrases come from a tiny table; the rest is marked as a test translation. */
export class MockTranslator implements Translator {
  async translate({ text, language }: TranslateRequest): Promise<string> {
    return PHRASES[text]?.[language] ?? `[${language}, test mode] ${text}`;
  }
}

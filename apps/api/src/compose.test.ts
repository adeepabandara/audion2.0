import { SIGNS } from '@audion/shared';
import { describe, expect, it } from 'vitest';
import { isGroundedSentence, unexpectedWords } from './services/composeGuard.js';
import { MockComposer } from './services/mock/composer.js';

describe('compose guard', () => {
  const cases: Array<[string[], string, boolean]> = [
    [['hello', 'please', 'wait'], 'Hello, please wait.', true],
    [['tomorrow', 'talk', 'finish'], "We'll finish talking tomorrow.", true],
    [['thankyou'], 'Thank you.', true],
    [['why', 'not'], "Why don't we?", true],
    [['hello', 'wait'], 'Hello, please wait at the airport.', false],
    [['yes'], 'Yes, I love pizza.', false],
    [['look', 'time'], 'Look at the clock.', false],
  ];
  it.each(cases)('%j -> %s', (glosses, sentence, grounded) => {
    expect(isGroundedSentence(sentence, glosses)).toBe(grounded);
  });

  it('names the invented words', () => {
    expect(unexpectedWords('Hello, please wait at the airport.', ['hello', 'wait'])).toEqual([
      'airport',
    ]);
  });
});

describe('mock composer', () => {
  const composer = new MockComposer();

  it('never invents words for any single sign, pair or triple of signs', async () => {
    for (const a of SIGNS) {
      expect(isGroundedSentence(await composer.compose({ signs: [a] }), [a])).toBe(true);
      for (const b of SIGNS) {
        const pair = [a, b];
        expect(isGroundedSentence(await composer.compose({ signs: pair }), pair)).toBe(true);
      }
    }
    for (const triple of [
      ['hello', 'please', 'wait'],
      ['tomorrow', 'talk', 'finish'],
      ['who', 'look', 'now'],
      ['thankyou', 'bye', 'later'],
    ]) {
      expect(isGroundedSentence(await composer.compose({ signs: triple }), triple)).toBe(true);
    }
  });

  it('output shape: capitalised and punctuated', async () => {
    const s = await composer.compose({ signs: ['where', 'time'] });
    expect(s).toMatch(/^[A-Z].*[.?]$/);
  });
});

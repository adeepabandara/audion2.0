import { describe, expect, it } from 'vitest';
import { MAX_SPEAK_CHARS } from './constants.js';
import {
  applyFeedback,
  FEEDBACK,
  fillTemplate,
  MAX_SHARE_CHARS,
  SHARE_TEMPLATES,
  speakable,
} from './shareTemplates.js';
import { MAX_PITCH, MIN_PITCH } from './voiceProfile.js';

describe('share templates', () => {
  it('fills in the name and the sender, and leaves them out neatly when missing', () => {
    const t = 'Hi{to}! Hello. — {from}';
    expect(fillTemplate(t, { to: 'Amma', from: 'Adeepa' })).toBe('Hi Amma! Hello. — Adeepa');
    expect(fillTemplate(t, {})).toBe('Hi! Hello.');
    expect(fillTemplate(t, { to: '  ', from: ' ' })).toBe('Hi! Hello.');
  });

  it('every template fits the message limit once filled, and asks for the same four replies', () => {
    for (const t of SHARE_TEMPLATES) {
      const text = fillTemplate(t.text, { to: 'Dilini', from: 'Adeepa Bandara' });
      expect(text.length).toBeLessThanOrEqual(MAX_SHARE_CHARS);
      expect(text).not.toContain('{');
      for (const word of ['higher', 'lower', 'faster', 'slower']) expect(text).toContain(word);
    }
  });

  it('turns a message into what the voice should say: no emoji or symbols, within the speech limit', () => {
    const spoken = speakable('Hi Amma! 💛 Reply 👍 if yes, or higher ⏫ · lower ⏬ — Adeepa');
    expect(spoken).toBe('Hi Amma! Reply if yes, or higher, lower. Adeepa');
    expect(speakable('word '.repeat(400)).length).toBeLessThanOrEqual(MAX_SPEAK_CHARS);
    for (const t of SHARE_TEMPLATES) {
      expect(speakable(fillTemplate(t.text, { to: 'Amma', from: 'Me' }))).not.toMatch(
        /\p{Extended_Pictographic}/u,
      );
    }
  });
});

describe('applyFeedback', () => {
  const base = { voiceId: 'aria', pitch: 0, speed: 1 } as const;

  it('makes a small change for higher, lower, faster and slower', () => {
    expect(applyFeedback(base, 'higher').pitch).toBe(1.5);
    expect(applyFeedback(base, 'lower').pitch).toBe(-1.5);
    expect(applyFeedback(base, 'faster').speed).toBe(1.1);
    expect(applyFeedback(base, 'slower').speed).toBe(0.9);
  });

  it('never goes outside the allowed range', () => {
    expect(applyFeedback({ ...base, pitch: MAX_PITCH }, 'higher').pitch).toBe(MAX_PITCH);
    expect(applyFeedback({ ...base, pitch: MIN_PITCH }, 'lower').pitch).toBe(MIN_PITCH);
    expect(applyFeedback({ ...base, speed: 1.5 }, 'faster').speed).toBe(1.5);
    expect(applyFeedback({ ...base, speed: 0.75 }, 'slower').speed).toBe(0.75);
  });

  it('leaves the voice alone for "sounds like me" and "another voice", and has a label for each reply', () => {
    expect(applyFeedback(base, 'good')).toEqual(base);
    expect(applyFeedback(base, 'different')).toEqual(base);
    expect(FEEDBACK.map((f) => f.id)).toEqual([
      'good',
      'higher',
      'lower',
      'faster',
      'slower',
      'different',
    ]);
    for (const f of FEEDBACK) expect(f.label.length).toBeGreaterThan(3);
  });
});

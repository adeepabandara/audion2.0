import { SIGNS } from '@audion/shared';
import { describe, expect, it } from 'vitest';
import { barClearance, clampPosition, EDGE_MARGIN, FALLBACK_BAR_CLEARANCE } from './position';
import { SIGN_INFO, SIGN_LIST } from './signs';

describe('position', () => {
  const view = { width: 1440, height: 900 };
  const card = { width: 320, height: 420 };

  it('never lets the card cover the control bar', () => {
    const p = clampPosition({ right: 30, bottom: 5 }, card, view, 108);
    expect(p.bottom).toBe(108);
  });

  it('keeps the card on screen at every edge', () => {
    expect(clampPosition({ right: -500, bottom: 100 }, card, view, 100).right).toBe(EDGE_MARGIN);
    expect(clampPosition({ right: 5000, bottom: 5000 }, card, view, 100)).toEqual({
      right: 1440 - 320 - EDGE_MARGIN,
      bottom: 900 - 420 - EDGE_MARGIN,
    });
  });

  it('prefers keeping clear of the bar over fitting when the window is tiny', () => {
    const p = clampPosition({ right: 0, bottom: 0 }, card, { width: 200, height: 300 }, 120);
    expect(p.bottom).toBe(120);
    expect(p.right).toBe(EDGE_MARGIN);
  });

  it('computes clearance from the bar top, with a fixed fallback', () => {
    expect(barClearance(820, 900)).toBe(92);
    expect(barClearance(null, 900)).toBe(FALLBACK_BAR_CLEARANCE);
  });
});

describe('supported signs sheet data', () => {
  it('describes every one of the 22 signs exactly once', () => {
    expect(SIGN_LIST).toHaveLength(22);
    expect(SIGN_LIST.map((s) => s.sign)).toEqual([...SIGNS]);
    for (const sign of SIGNS) {
      expect(SIGN_INFO[sign].hint.length, sign).toBeGreaterThan(10);
      expect(SIGN_INFO[sign].hint.endsWith('.'), sign).toBe(true);
    }
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { LandmarkFrame } from '../lib/landmarks';
import { drawLandmarks } from './draw';

const frame: LandmarkFrame = {
  t: 0,
  hands: [
    {
      handedness: 'Unknown',
      landmarks: Array.from({ length: 21 }, () => ({ x: 0.25, y: 0.5, z: 0 })),
    },
  ],
};

const ctx = () => ({
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
});

describe('drawLandmarks', () => {
  it('mirrors the dots like the live camera preview by default', () => {
    const c = ctx();
    drawLandmarks(c, frame, 100, 100);
    expect(c.arc.mock.calls[0]?.[0]).toBeCloseTo(75); // (1 - 0.25) * 100
  });

  it('draws the dots as they are for a video file (not mirrored)', () => {
    const c = ctx();
    drawLandmarks(c, frame, 100, 100, undefined, false);
    expect(c.arc.mock.calls[0]?.[0]).toBeCloseTo(25);
  });
});

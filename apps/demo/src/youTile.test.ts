import { describe, expect, it, vi } from 'vitest';
import { showSelf } from './youTile';

const stream = () => ({ id: 'cam' }) as unknown as MediaStream;
function video() {
  const v = document.createElement('video');
  v.hidden = true;
  v.play = vi.fn(() => Promise.resolve());
  return v;
}

describe('the You tile', () => {
  it('shows the live camera, mirrored, while Ola has it', () => {
    const v = video();
    const s = stream();
    showSelf(v, s);
    expect(v.srcObject).toBe(s);
    expect(v.hidden).toBe(false);
    expect(v.classList.contains('is-file')).toBe(false); // mirrored by the page's CSS
    expect(v.play).toHaveBeenCalled();
  });

  it('shows a test video file unmirrored', () => {
    const v = video();
    showSelf(v, stream(), { fromFile: true });
    expect(v.classList.contains('is-file')).toBe(true);
  });

  it('goes back to the initial when Ola lets the camera go', () => {
    const v = video();
    showSelf(v, stream());
    showSelf(v, null);
    expect(v.srcObject).toBeNull();
    expect(v.hidden).toBe(true);
  });

  it('does nothing without a tile', () => {
    expect(() => showSelf(null, stream())).not.toThrow();
  });
});

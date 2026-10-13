import { beforeEach, describe, expect, it } from 'vitest';
import { isMeetCallPath, locateControlBar, type Rect } from './meetDom';

const VIEW = { width: 1440, height: 900 };
const rect = (top: number, height: number, left = 0, width = 1440): Rect => ({
  top,
  bottom: top + height,
  left,
  right: left + width,
  width,
  height,
});

/** Rects keyed by data-r attribute: jsdom has no layout, so tests supply geometry. */
const geometry: Record<string, Rect> = {};
const rectOf = (el: Element) => geometry[el.getAttribute('data-r') ?? ''] ?? rect(0, 0, 0, 0);

beforeEach(() => {
  document.body.innerHTML = '';
  for (const k of Object.keys(geometry)) delete geometry[k];
});

describe('locateControlBar', () => {
  it('finds a Meet-style bar from the Leave call button and climbs to the wide strip', () => {
    document.body.innerHTML = `
      <div data-r="page"><div data-r="stage"></div>
        <div data-r="bar"><div data-r="row">
          <button aria-label="Turn off microphone" data-r="mic"></button>
          <button aria-label="Leave call" data-r="leave"></button>
        </div></div></div>`;
    Object.assign(geometry, {
      page: rect(0, 900),
      bar: rect(820, 80),
      row: rect(826, 68, 400, 640),
      mic: rect(830, 48, 420, 48),
      leave: rect(830, 48, 700, 64),
    });
    const bar = locateControlBar(document, VIEW, rectOf);
    expect(bar?.element.getAttribute('data-r')).toBe('bar');
    expect(bar?.top).toBe(820);
  });

  it('recognises a simpler toolbar (fake Meet) by media-button labels', () => {
    document.body.innerHTML = `<div role="toolbar" data-r="bar"><button aria-label="Turn on camera" data-r="cam"></button></div>`;
    Object.assign(geometry, { bar: rect(820, 80), cam: rect(830, 48, 600, 56) });
    expect(locateControlBar(document, VIEW, rectOf)?.top).toBe(820);
  });

  it('ignores matching buttons that are not in the lower part of the screen', () => {
    document.body.innerHTML = `<div data-r="hdr"><button aria-label="Leave call" data-r="leave"></button></div>`;
    Object.assign(geometry, { hdr: rect(0, 60), leave: rect(10, 40, 100, 40) });
    expect(locateControlBar(document, VIEW, rectOf)).toBeNull();
  });

  it('returns null when nothing recognisable exists (caller falls back to a fixed offset)', () => {
    document.body.innerHTML = `<div data-r="a"><button data-r="b">Hello</button></div>`;
    expect(locateControlBar(document, VIEW, rectOf)).toBeNull();
  });

  it('never climbs to a container that covers most of the page', () => {
    document.body.innerHTML = `<div data-r="app"><div data-r="stage"><button aria-label="Leave call" data-r="leave"></button></div></div>`;
    Object.assign(geometry, {
      app: rect(0, 900),
      stage: rect(100, 800),
      leave: rect(830, 48, 700, 64),
    });
    expect(locateControlBar(document, VIEW, rectOf)?.element.getAttribute('data-r')).toBe('leave');
  });
});

describe('isMeetCallPath', () => {
  it.each([
    ['/abc-defg-hij', true],
    ['/abc-defg-hij/', true],
    ['/lookup/xyz', true],
    ['/', false],
    ['/landing', false],
    ['/new', false],
  ])('%s -> %s', (path, expected) => expect(isMeetCallPath(path)).toBe(expected));
});

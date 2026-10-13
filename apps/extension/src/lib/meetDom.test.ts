import { beforeEach, describe, expect, it, vi } from 'vitest';
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

import { postToChat, watchLeaveCall } from './meetDom';

describe('postToChat', () => {
  const closedChat = `
    <div role="toolbar"><button aria-label="Chat with everyone" id="toggle">Chat</button></div>`;
  const chatPanel = `
    <aside id="panel"><textarea aria-label="Send a message" id="box"></textarea>
    <button aria-label="Send a message to everyone" id="send">Send</button></aside>`;

  /** Meet-like: the panel does not exist until the toggle is clicked, and Send is disabled until there is text. */
  function wire(opts: { startOpen?: boolean; draft?: string; noSend?: boolean } = {}) {
    document.body.innerHTML = closedChat + (opts.startOpen ? chatPanel : '');
    const sent: string[] = [];
    const attach = () => {
      const box = document.getElementById('box') as HTMLTextAreaElement | null;
      const send = document.getElementById('send') as HTMLButtonElement | null;
      if (!box || !send) return;
      if (opts.draft) box.value = opts.draft;
      send.disabled = true;
      box.addEventListener('input', () => (send.disabled = !box.value.trim()));
      send.addEventListener('click', () => {
        sent.push(box.value);
        box.value = '';
        send.disabled = true;
      });
      if (opts.noSend) send.remove();
    };
    document.getElementById('toggle')!.addEventListener('click', () => {
      const panel = document.getElementById('panel');
      if (panel) panel.remove();
      else {
        document.body.insertAdjacentHTML('beforeend', chatPanel);
        attach();
      }
    });
    if (opts.startOpen) attach();
    return sent;
  }

  it('opens the chat panel, posts, and closes it again', async () => {
    const sent = wire();
    expect(await postToChat('Hello, please wait.')).toBe('sent');
    expect(sent).toEqual(['Hello, please wait.']);
    expect(document.getElementById('panel')).toBeNull(); // left as we found it
  });

  it('posts into an already-open chat and leaves it open', async () => {
    const sent = wire({ startOpen: true });
    expect(await postToChat('Thank you.')).toBe('sent');
    expect(sent).toEqual(['Thank you.']);
    expect(document.getElementById('panel')).not.toBeNull();
  });

  it('never overwrites what the user is typing', async () => {
    const sent = wire({ startOpen: true, draft: 'half a thought' });
    expect(await postToChat('Hello.')).toBe('draft');
    expect(sent).toEqual([]);
    expect((document.getElementById('box') as HTMLTextAreaElement).value).toBe('half a thought');
  });

  it('reports no-chat when Meet has no chat control, and failed when Send is missing', async () => {
    document.body.innerHTML = '<div>nothing here</div>';
    expect(await postToChat('Hi', document, { openWaitMs: 100 })).toBe('no-chat');
    wire({ startOpen: true, noSend: true });
    expect(await postToChat('Hi')).toBe('failed');
  });
});

describe('watchLeaveCall', () => {
  it('fires when the Leave call button (or something inside it) is clicked, until unsubscribed', () => {
    document.body.innerHTML =
      '<button aria-label="Leave call"><span id="icon">x</span></button><button aria-label="Chat with everyone" id="other">c</button>';
    const cb = vi.fn();
    const off = watchLeaveCall(cb);
    document.getElementById('other')!.click();
    expect(cb).not.toHaveBeenCalled();
    document.getElementById('icon')!.click();
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    document.getElementById('icon')!.click();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

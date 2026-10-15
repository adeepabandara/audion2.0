/**
 * The ONLY module that reads Meet's DOM. Meet's markup is obfuscated and changes without notice, so every
 * lookup here is heuristic, feature-detected, and returns null when unsure; callers must have a fallback.
 * Prefer ARIA labels (which Meet needs for accessibility and which change rarely) over class names.
 */

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export type RectFn = (el: Element) => Rect;

const defaultRect: RectFn = (el) => el.getBoundingClientRect();

const LEAVE = /leave call|leave meeting|end call/i;
const MEDIA_BUTTON = /turn (on|off) (microphone|camera)|(microphone|camera)(,|$)/i;

export interface ControlBar {
  element: Element;
  /** Top edge of the bar in viewport coordinates. */
  top: number;
}

/**
 * Finds the bottom call-control bar: start from a control we can recognise by label (Leave call, mic, camera),
 * then climb to the widest ancestor that still sits in the lower part of the viewport and spans most of its width.
 */
export function locateControlBar(
  doc: Document = document,
  viewport: { width: number; height: number } = { width: innerWidth, height: innerHeight },
  rectOf: RectFn = defaultRect,
): ControlBar | null {
  const anchors = [
    ...doc.querySelectorAll<HTMLElement>('button[aria-label], [role="button"][aria-label]'),
  ].filter((el) => {
    const label = el.getAttribute('aria-label') ?? '';
    return LEAVE.test(label) || MEDIA_BUTTON.test(label);
  });

  const inLowerQuarter = (r: Rect) => r.height > 0 && r.top > viewport.height * 0.7;
  let best: ControlBar | null = null;

  for (const anchor of anchors) {
    if (!inLowerQuarter(rectOf(anchor))) continue;
    let el: Element | null = anchor;
    let candidate: Element = anchor;
    // Climb while the parent is still a bar-like strip at the bottom: wide-ish, short, not the whole page.
    while (el?.parentElement && el.parentElement !== doc.body) {
      const pr = rectOf(el.parentElement);
      if (pr.height > viewport.height * 0.25 || pr.top < viewport.height * 0.7) break;
      el = el.parentElement;
      if (pr.width >= viewport.width * 0.4) candidate = el;
    }
    const r = rectOf(candidate);
    if (!best || r.top < best.top) best = { element: candidate, top: r.top };
  }
  return best;
}

/** Meet call URLs look like /abc-defg-hij (also seen with a trailing path or query). */
export function isMeetCallPath(pathname: string): boolean {
  return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\/|$)/i.test(pathname) || /^\/lookup\//.test(pathname);
}

// ---- Chat ------------------------------------------------------------------------------------------------

const CHAT_TOGGLE = /^(chat with everyone|open chat|close chat|show chat|in-call messages)/i;
const CHAT_INPUT = /send a message|message/i;
const CHAT_SEND = /send/i;

const visible = (el: Element) =>
  !(el as HTMLElement).hidden && el.getAttribute('aria-hidden') !== 'true';

export function findChatInput(
  doc: Document = document,
): HTMLTextAreaElement | HTMLInputElement | null {
  const candidates = doc.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
    'textarea, input[type="text"]',
  );
  for (const el of candidates) {
    const label = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('placeholder') ?? ''}`;
    if (CHAT_INPUT.test(label) && visible(el) && !el.closest('[hidden]')) return el;
  }
  return null;
}

export function findChatToggle(doc: Document = document): HTMLElement | null {
  for (const el of doc.querySelectorAll<HTMLElement>(
    'button[aria-label], [role="button"][aria-label]',
  )) {
    if (CHAT_TOGGLE.test(el.getAttribute('aria-label') ?? '')) return el;
  }
  return null;
}

function findChatSend(input: Element): HTMLButtonElement | null {
  // Search outward from the input for the nearest container that holds a send button.
  for (let el: Element | null = input.parentElement; el; el = el.parentElement) {
    for (const b of el.querySelectorAll<HTMLButtonElement>('button[aria-label]')) {
      if (CHAT_SEND.test(b.getAttribute('aria-label') ?? '')) return b;
    }
    if (el === input.ownerDocument.body) break;
  }
  return null;
}

export type ChatPostResult = 'sent' | 'draft' | 'no-chat' | 'failed';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(get: () => T | null, timeoutMs: number, stepMs = 50): Promise<T | null> {
  for (let waited = 0; ; waited += stepMs) {
    const v = get();
    if (v || waited >= timeoutMs) return v;
    await sleep(stepMs);
  }
}

/**
 * Types `text` into Meet's chat and sends it. Opens the chat panel if needed and closes it again afterwards.
 * Never overwrites something the user has already typed ('draft').
 */
export async function postToChat(
  text: string,
  doc: Document = document,
  opts: { openWaitMs?: number } = {},
): Promise<ChatPostResult> {
  let input = findChatInput(doc);
  let opened: HTMLElement | null = null;
  if (!input) {
    const toggle = findChatToggle(doc);
    if (!toggle) return 'no-chat';
    toggle.click();
    opened = toggle;
    input = await waitFor(() => findChatInput(doc), opts.openWaitMs ?? 1500);
    if (!input) return 'no-chat';
  }
  const closeIfWeOpened = () => opened && (findChatToggle(doc) ?? opened).click();

  if (input.value.trim()) {
    closeIfWeOpened();
    return 'draft';
  }
  // Set the value the way a user's typing would, so Meet's framework notices the change.
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(30);

  const send = findChatSend(input);
  if (!send || send.disabled) {
    input.value = '';
    closeIfWeOpened();
    return 'failed';
  }
  send.click();
  await sleep(30);
  closeIfWeOpened();
  return 'sent';
}

// ---- Leaving the call --------------------------------------------------------------------------------------

/** Calls `cb` when the user clicks Meet's Leave call button. Returns an unsubscribe function. */
export function watchLeaveCall(cb: () => void, doc: Document = document): () => void {
  const onClick = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.(
      'button[aria-label], [role="button"][aria-label]',
    );
    if (el && LEAVE.test(el.getAttribute('aria-label') ?? '')) cb();
  };
  doc.addEventListener('click', onClick, true); // capture: Meet may stop propagation
  return () => doc.removeEventListener('click', onClick, true);
}

// ---- Live captions -------------------------------------------------------------------------------------------

/** Text Meet puts inside its caption area that is interface, not speech. */
const CAPTION_CHROME = /^(captions?|jump to bottom|live captions?|turn off captions?)$/i;

/**
 * Meet's live-caption area (the signer must have captions switched on in Meet: the CC button). Found by its ARIA
 * label, which Meet needs for accessibility and which changes rarely. Null when captions are off or the markup moved.
 */
export function findCaptionRegion(doc: Document = document): Element | null {
  return (
    doc.querySelector('[role="region"][aria-label*="aption" i]') ??
    doc.querySelector('[aria-label="Captions" i]') ??
    null
  );
}

/**
 * The caption text on screen right now, one string per line (speaker names and their words). Read from the text of
 * the innermost elements, so it does not depend on how Meet lays the blocks out.
 */
export function readCaptionLines(doc: Document = document): string[] {
  const region = findCaptionRegion(doc);
  if (!region) return [];
  const leaves = [...region.querySelectorAll('*')].filter(
    (el) => el.children.length === 0 && (el.textContent ?? '').trim(),
  );
  const raw = leaves.length ? leaves.map((el) => el.textContent ?? '') : [region.textContent ?? ''];
  return raw.map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l && !CAPTION_CHROME.test(l));
}

/**
 * Calls `cb` with the captions on screen whenever they change (checked a few times a second, and only when the
 * caption area exists). Meet shows only the last few lines, so callers get overlapping snapshots and must de-duplicate.
 * Returns an unsubscribe function. Nothing is stored here.
 */
export function watchCaptions(
  cb: (lines: string[]) => void,
  doc: Document = document,
  everyMs = 700,
): () => void {
  let last = '';
  const id = setInterval(() => {
    const lines = readCaptionLines(doc);
    const key = lines.join('\n');
    if (lines.length && key !== last) {
      last = key;
      cb(lines);
    }
  }, everyMs);
  return () => clearInterval(id);
}

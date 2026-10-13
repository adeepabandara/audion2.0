import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../lib/api';
import type { TranscriptEntry } from '../lib/messages';
import { memoryStore } from '../lib/storage';
import { createMessageHandler } from './handler';

function setup() {
  const api = {
    feedback: vi.fn(async () => ({ ok: true })),
    health: vi.fn(),
  } as unknown as ApiClient;
  const transcripts = memoryStore();
  const handle = createMessageHandler(api, async () => {}, transcripts);
  return { api, transcripts, handle };
}

describe('transcript storage', () => {
  it('keeps what was spoken, with timestamps, per tab', async () => {
    const { handle } = setup();
    await handle({ type: 'transcript/add', text: 'Hello.' }, { tabId: 1 });
    await handle({ type: 'transcript/add', text: 'Please wait.' }, { tabId: 1 });
    await handle({ type: 'transcript/add', text: 'Other call.' }, { tabId: 2 });

    const one = (await handle({ type: 'transcript/get' }, { tabId: 1 })) as {
      entries: TranscriptEntry[];
    };
    expect(one.entries.map((e) => e.text)).toEqual(['Hello.', 'Please wait.']);
    expect(one.entries.every((e) => e.at > 0)).toBe(true);
    const two = (await handle({ type: 'transcript/get' }, { tabId: 2 })) as {
      entries: TranscriptEntry[];
    };
    expect(two.entries.map((e) => e.text)).toEqual(['Other call.']);
  });

  it('clearing one call leaves the other alone', async () => {
    const { handle } = setup();
    await handle({ type: 'transcript/add', text: 'A' }, { tabId: 1 });
    await handle({ type: 'transcript/add', text: 'B' }, { tabId: 2 });
    await handle({ type: 'transcript/clear' }, { tabId: 1 });
    expect(
      ((await handle({ type: 'transcript/get' }, { tabId: 1 })) as { entries: unknown[] }).entries,
    ).toEqual([]);
    expect(
      ((await handle({ type: 'transcript/get' }, { tabId: 2 })) as { entries: unknown[] }).entries,
    ).toHaveLength(1);
  });

  it('is bounded', async () => {
    const { handle } = setup();
    for (let i = 0; i < 230; i++)
      await handle({ type: 'transcript/add', text: `s${i}` }, { tabId: 1 });
    const { entries } = (await handle({ type: 'transcript/get' }, { tabId: 1 })) as {
      entries: TranscriptEntry[];
    };
    expect(entries).toHaveLength(200);
    expect(entries.at(-1)!.text).toBe('s229');
  });
});

describe('feedback', () => {
  it('forwards only the rating and sign labels to the API', async () => {
    const { handle, api } = setup();
    await handle({ type: 'api/feedback', rating: 'up', signs: ['hello', 'wait'] }, { tabId: 1 });
    expect(api.feedback).toHaveBeenCalledWith({ rating: 'up', signs: ['hello', 'wait'] });
  });
});

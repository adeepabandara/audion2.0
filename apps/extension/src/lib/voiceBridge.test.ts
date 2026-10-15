import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTENT_SOURCE, INJECT_SOURCE, type ToInject } from './voiceProtocol';
import { VoiceBridge } from './voiceBridge';

afterEach(() => vi.restoreAllMocks());

describe('VoiceBridge delivery reports', () => {
  it('tells listeners after each sentence whether it reached the call', () => {
    const { bridge, reply } = setup();
    const seen: Array<boolean | null> = [];
    const off = bridge.onDelivery((s) => seen.push(s));
    const base = { source: INJECT_SOURCE, type: 'speak-result', result: 'done' };
    reply({ ...base, id: 1, sent: false });
    reply({ ...base, id: 2, sent: true });
    reply({ ...base, id: 3, sent: null });
    reply({ ...base, id: 4 }); // an older page script that does not measure
    expect(seen).toEqual([false, true, null]);
    off();
    reply({ ...base, id: 5, sent: true });
    expect(seen).toHaveLength(3);
    bridge.dispose();
  });
});

describe('VoiceBridge monitor flag', () => {
  it('tells the page script whether to also play the voice on the speakers', () => {
    const sent: ToInject[] = [];
    vi.spyOn(window, 'postMessage').mockImplementation(
      ((msg: ToInject) => void sent.push(msg)) as never,
    );
    const bridge = new VoiceBridge(window, 50);
    void bridge.speak(new Uint8Array([1, 2]), { monitor: true });
    void bridge.speak(new Uint8Array([1, 2]));
    expect(sent.map((m) => (m.type === 'speak' ? m.monitor : 'x'))).toEqual([true, false]);
    bridge.dispose();
  });
});

function setup() {
  const sent: Array<{ msg: ToInject; origin: string; transfer?: Transferable[] }> = [];
  vi.spyOn(window, 'postMessage').mockImplementation(
    ((msg: ToInject, origin: string, transfer?: Transferable[]) =>
      void sent.push({ msg, origin, transfer })) as never,
  );
  const bridge = new VoiceBridge(window, 200);
  const reply = (data: unknown, init: Partial<MessageEventInit> = {}) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data,
        source: window,
        origin: window.location.origin,
        ...init,
      }),
    );
  return { bridge, sent, reply };
}

describe('VoiceBridge', () => {
  it('sends audio to the MAIN world (same origin, transferred) and resolves with its result', async () => {
    const { bridge, sent, reply } = setup();
    const p = bridge.speak(new Uint8Array([1, 2, 3]));
    const { msg, origin, transfer } = sent[0]!;
    expect(msg).toMatchObject({ source: CONTENT_SOURCE, type: 'speak' });
    expect(origin).toBe(window.location.origin);
    expect(transfer).toHaveLength(1);
    reply({
      source: INJECT_SOURCE,
      type: 'speak-result',
      id: (msg as { id: number }).id,
      result: 'done',
    });
    expect(await p).toBe('done');
  });

  it('matches replies to the right request', async () => {
    const { bridge, sent, reply } = setup();
    const a = bridge.speak(new Uint8Array([1]));
    const b = bridge.speak(new Uint8Array([2]));
    const [ida, idb] = sent.map((s) => (s.msg as { id: number }).id);
    reply({ source: INJECT_SOURCE, type: 'speak-result', id: idb, result: 'muted' });
    reply({ source: INJECT_SOURCE, type: 'speak-result', id: ida, result: 'no-channel' });
    expect([await a, await b]).toEqual(['no-channel', 'muted']);
  });

  it('ignores replies from another origin, and times out to an error rather than hanging', async () => {
    const { bridge, sent, reply } = setup();
    const p = bridge.speak(new Uint8Array([1]));
    reply(
      {
        source: INJECT_SOURCE,
        type: 'speak-result',
        id: (sent[0]!.msg as { id: number }).id,
        result: 'done',
      },
      { origin: 'https://evil.example' },
    );
    expect(await p).toBe('error');
  });

  it('forwards channel updates and config', () => {
    const { bridge, sent, reply } = setup();
    const seen: unknown[] = [];
    const off = bridge.onChannel((s) => seen.push(s));
    reply({ source: INJECT_SOURCE, type: 'channel', hasChannel: true, micMuted: true });
    off();
    reply({ source: INJECT_SOURCE, type: 'channel', hasChannel: false, micMuted: false });
    expect(seen).toEqual([expect.objectContaining({ hasChannel: true, micMuted: true })]);
    bridge.configure({ enabled: true, voiceMuted: false });
    expect(sent.at(-1)!.msg).toMatchObject({ type: 'config', enabled: true, voiceMuted: false });
  });

  it('probe falls back to "no channel" on timeout', async () => {
    const { bridge } = setup();
    expect(await bridge.probe()).toEqual({ hasChannel: false, micMuted: false, peak: 0 });
  });
});

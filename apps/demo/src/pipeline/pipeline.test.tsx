import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchitectureView } from './ArchitectureView';
import { apiName, describe as describeEvent, emptyStats, PipelineBus, reduce } from './bus';
import {
  EDGE_BY_ID,
  EDGES,
  NODES,
  nodesFor,
  routeFor,
  type PipelineEvent,
  type Stamped,
} from './model';

const ALL_EVENTS: PipelineEvent[] = [
  { kind: 'frame', hands: 2 },
  { kind: 'signing', on: true },
  { kind: 'device', sign: 'yes', confidence: 0.9, ms: 12 },
  { kind: 'device-unsure', sign: 'no', confidence: 0.4, ms: 12 },
  { kind: 'cloud', role: 'check', sign: 'yes', ms: 2900, deviceSign: 'no' },
  { kind: 'sentence', sentence: 'Hello.', writer: 'Gemma, on this device', ms: 300 },
  { kind: 'sentence', sentence: 'Hello.', writer: 'Gemini, on Google Cloud', ms: 1900 },
  { kind: 'voice', voiceId: 'aria', ms: 640 },
  { kind: 'voice-check', heard: 'Hello there.', ms: 900, mode: 'google' },
  { kind: 'translate', language: 'es', ms: 800 },
  { kind: 'context', summary: 'A demo.', ms: 1800, chars: 200 },
  { kind: 'caption', speaker: 'Priya', text: 'Hi' },
  { kind: 'api', path: 'api/speak', ok: true, ms: 600 },
  { kind: 'gemma', state: 'ready' },
  { kind: 'service', mode: 'live', modelId: 'gemini', voices: 'google' },
];

describe('the live log says what the model saw', () => {
  const guess = { kind: 'device', sign: 'listen', confidence: 0.62, ms: 4 } as const;

  it('lists what else it considered, and how much it saw', () => {
    const text = describeEvent({
      ...guess,
      top: [
        { sign: 'listen', confidence: 0.62 },
        { sign: 'hello', confidence: 0.21 },
        { sign: 'talk', confidence: 0.09 },
      ],
      frames: 14,
      hands: 1,
    })!;
    expect(text).toContain('“listen”');
    expect(text).toContain('Also considered: hello 21%, talk 9%.');
    expect(text).toContain('It saw 14 frames with 1 hand.');
    expect(text).not.toContain('Both hands');
    expect(text).not.toContain('very short');
  });

  it('says so when both hands were in view and the model was not sure', () => {
    const text = describeEvent({ ...guess, frames: 20, hands: 2 })!;
    expect(text).toContain('with 2 hands');
    expect(text).toContain('keep the other hand out of the picture');
  });

  it('says so when the sign was very short and the model was not sure', () => {
    const text = describeEvent({ ...guess, frames: 7, hands: 1 })!;
    expect(text).toContain('very short sign');
  });

  it('keeps the hints to itself when the model was sure, and when it knows nothing extra', () => {
    expect(describeEvent({ ...guess, confidence: 0.95, frames: 7, hands: 2 })).not.toContain(
      'Both hands',
    );
    expect(describeEvent(guess)).toBe('Sign “listen” named on this device (62% sure, 4 ms).');
    const unsure = describeEvent({
      kind: 'device-unsure',
      sign: 'no',
      confidence: 0.4,
      ms: 5,
      threshold: 0.5,
      then: 'retry',
      frames: 6,
      hands: 2,
    })!;
    expect(unsure).toContain('not accepted');
    expect(unsure).toContain('keep the other hand out of the picture');
    expect(unsure).toContain('very short sign');
  });
});

describe('architecture model', () => {
  it('shows that signs are read from the hands AND the body (MediaPipe Pose)', () => {
    const tracking = NODES.find((n) => n.id === 'mediapipe')!;
    expect(tracking.title).toMatch(/body/i);
    expect(tracking.what).toMatch(/Pose Landmarker/);
    expect(NODES.find((n) => n.id === 'classifier')!.what).toMatch(/on the body/);
    expect(EDGE_BY_ID['mp-seg'].label).toMatch(/body/);
  });

  it('has unique steps, and every edge and route points at things that exist', () => {
    expect(new Set(NODES.map((n) => n.id)).size).toBe(NODES.length);
    expect(NODES).toHaveLength(13);
    expect(new Set(EDGES.map((e) => e.id)).size).toBe(EDGES.length);
    for (const e of ALL_EVENTS) {
      for (const hop of routeFor(e)) expect(EDGE_BY_ID[hop.edge], hop.edge).toBeTruthy();
      for (const id of nodesFor(e))
        expect(
          NODES.some((n) => n.id === id),
          id,
        ).toBe(true);
    }
  });

  it('puts every step in the right place: the model, rules and sentence step on the device, the rest in the cloud', () => {
    const zone = Object.fromEntries(NODES.map((n) => [n.id, n.zone]));
    expect(zone).toMatchObject({
      camera: 'device',
      mediapipe: 'device',
      segmenter: 'device',
      classifier: 'device',
      sentence: 'device',
      speaker: 'device',
      api: 'cloud',
      gemini: 'cloud',
      tts: 'cloud',
    });
  });

  it('sends a named sign from the detector to the model to the sentence step, with no cloud call', () => {
    const route = routeFor({ kind: 'device', sign: 'yes', confidence: 0.9, ms: 5 });
    expect(route.map((h) => h.edge)).toEqual(['seg-clf', 'clf-sent']);
    expect(route.every((h) => !h.back)).toBe(true);
    // an unsure answer goes to the model and stops there
    expect(
      routeFor({ kind: 'device-unsure', sign: 'no', confidence: 0.3, ms: 5 }).map((h) => h.edge),
    ).toEqual(['seg-clf']);
  });

  it('shows the Gemini check as a trip to the cloud and back', () => {
    const hops = routeFor({ kind: 'cloud', role: 'check', sign: 'a', ms: 1 });
    expect(hops.map((h) => `${h.edge}${h.back ? '<' : '>'}`)).toEqual([
      'seg-api>',
      'api-gem>',
      'api-gem<',
    ]);
    expect(hops.map((h) => h.delay)).toEqual([0, 650, 1300]);
  });

  it('sends a sentence to the cloud only when Gemma did not write it', () => {
    const gemma = routeFor({
      kind: 'sentence',
      sentence: 'x',
      writer: 'Gemma, on this device',
      ms: 1,
    });
    const gemini = routeFor({
      kind: 'sentence',
      sentence: 'x',
      writer: 'Gemini, on Google Cloud',
      ms: 1,
    });
    expect(gemma).toEqual([]);
    expect(
      nodesFor({ kind: 'sentence', sentence: 'x', writer: 'Gemma, on this device', ms: 1 }),
    ).toEqual(['sentence']);
    expect(gemini.map((h) => h.edge)).toEqual(['sent-api', 'api-gem', 'api-gem', 'sent-api']);
  });

  it('follows speech out to the speakers, and the meeting summary back to the sentence step', () => {
    expect(routeFor({ kind: 'voice', voiceId: 'a', ms: 1 }).map((h) => h.edge)).toEqual([
      'sent-api',
      'api-tts',
      'prof-tts',
      'api-tts',
      'tts-spk',
    ]);
    // The voice check: the voice profile goes to Text-to-Speech, the sample to Speech-to-Text, the text back.
    const check = { kind: 'voice-check', heard: 'x', ms: 1, mode: 'google' } as const;
    expect(routeFor(check).map((h) => h.edge)).toEqual(['prof-tts', 'tts-stt', 'stt-prof']);
    expect(nodesFor(check)).toEqual(['profile', 'tts', 'stt']);
    const ctx = routeFor({ kind: 'context', summary: 's', ms: 1, chars: 1 });
    expect(ctx[0]!.edge).toBe('ctx-api');
    expect(ctx.at(-1)!.edge).toBe('ctx-sent');
  });

  it('draws no dots for events that are only bookkeeping', () => {
    for (const e of ALL_EVENTS.filter((e) =>
      ['api', 'gemma', 'service', 'signing'].includes(e.kind),
    ))
      expect(routeFor(e)).toEqual([]);
  });
});

describe('PipelineBus', () => {
  it('counts hand-tracking frames per second over the last two seconds', () => {
    const bus = new PipelineBus();
    for (let i = 0; i < 30; i++) bus.emit({ kind: 'frame', hands: 1 }, 10_000 + i * 66);
    expect(bus.snapshot(12_000).fps).toBe(15);
    expect(bus.snapshot(30_000).fps).toBe(0); // nothing recent
  });

  it('keeps the counts and last values, and a plain-words feed, newest first', () => {
    const bus = new PipelineBus();
    bus.emit({ kind: 'device', sign: 'where', confidence: 0.91, ms: 14 }, 1000);
    bus.emit({ kind: 'device-unsure', sign: 'not', confidence: 0.4, ms: 9 }, 2000);
    bus.emit(
      { kind: 'sentence', sentence: 'What time is it?', writer: 'Gemma, on this device', ms: 310 },
      3000,
    );
    const s = bus.snapshot(3000);
    expect(s.signs).toBe(1);
    expect(s.unsure).toBe(1);
    expect(s.lastSign).toEqual({ sign: 'where', confidence: 0.91, ms: 14 });
    expect(s.lastSentence?.writer).toBe('Gemma, on this device');
    expect(s.feed.map((l) => l.text)).toEqual([
      'Sentence “What time is it?” written by Gemma, on this device (310 ms).',
      'Sign model unsure (“not”, 40%): not accepted.',
      'Sign “where” named on this device (91% sure, 14 ms).',
    ]);
  });

  it('does not list frames, signing or service info in the feed, and keeps at most 40 lines', () => {
    const bus = new PipelineBus();
    bus.emit({ kind: 'frame', hands: 2 });
    bus.emit({ kind: 'signing', on: true });
    bus.emit({ kind: 'service', mode: 'mock', modelId: 'mock', voices: 'mock' });
    expect(bus.snapshot().feed).toEqual([]);
    for (let i = 0; i < 60; i++) bus.emit({ kind: 'caption', speaker: 'A', text: `line ${i}` });
    const feed = bus.snapshot().feed;
    expect(feed).toHaveLength(40);
    expect(feed[0]!.text).toContain('line 59');
  });

  it('marks samples as samples, and remembers the service and Gemma state', () => {
    const bus = new PipelineBus();
    bus.emit({ kind: 'voice', voiceId: 'aria', ms: 600, simulated: true });
    bus.emit({ kind: 'service', mode: 'mock', modelId: 'mock', voices: 'mock' });
    bus.emit({ kind: 'gemma', state: 'loading' });
    const s = bus.snapshot();
    expect(s.feed.find((l) => l.kind === 'voice')).toMatchObject({ simulated: true });
    expect(s.feed.find((l) => l.kind === 'voice')!.text.startsWith('(sample) ')).toBe(true);
    expect(s.service).toEqual({ mode: 'mock', modelId: 'mock', voices: 'mock' });
    expect(s.gemma).toBe('loading');
  });

  it('keeps the six most recent API calls, newest first, and counts them all', () => {
    const bus = new PipelineBus();
    for (let i = 0; i < 9; i++)
      bus.emit({ kind: 'api', path: 'api/compose', ok: i !== 3, ms: i * 10 }, 1000 + i);
    const s = bus.snapshot();
    expect(s.apiCount).toBe(9);
    expect(s.apiCalls).toHaveLength(6);
    expect(s.apiCalls[0]!.ms).toBe(80);
  });

  it('tells event listeners at once and statistics listeners a little later, or on flush', () => {
    vi.useFakeTimers();
    const bus = new PipelineBus(150);
    const onEvent = vi.fn();
    const onStats = vi.fn();
    bus.onEvent(onEvent);
    bus.subscribe(onStats);
    bus.emit({ kind: 'frame', hands: 1 });
    bus.emit({ kind: 'frame', hands: 1 });
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onStats).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onStats).toHaveBeenCalledTimes(1); // one calm update for both events
    bus.emit({ kind: 'frame', hands: 1 });
    bus.flush();
    expect(onStats).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('words the Gemini check as agreeing or correcting, and names the API calls kindly', () => {
    expect(
      describeEvent({ kind: 'cloud', role: 'check', sign: 'yes', ms: 2000, deviceSign: 'yes' }),
    ).toContain('agreed');
    expect(
      describeEvent({ kind: 'cloud', role: 'check', sign: 'no', ms: 2000, deviceSign: 'yes' }),
    ).toContain('“no” instead of “yes”');
    expect(apiName('api/context')).toBe('Summarise the meeting');
    expect(apiName('api/unknown')).toBe('api/unknown');
    expect(reduce(emptyStats(), { kind: 'frame', hands: 2 }, 0, () => 1).hands).toBe(2);
  });
});

describe('ArchitectureView', () => {
  let bus: PipelineBus;
  beforeEach(() => {
    bus = new PipelineBus(10);
    // jsdom has no matchMedia: motion is on unless a test says otherwise
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({
        matches: false,
        media: q,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.style.overflow = '';
  });

  const view = (open = true, onClose = vi.fn()) =>
    render(<ArchitectureView bus={bus} open={open} onClose={onClose} />);
  const emit = (e: Stamped) => act(() => void (bus.emit(e), bus.flush()));

  it('renders nothing while closed', () => {
    const { container } = view(false);
    expect(container.firstChild).toBeNull();
  });

  it('opens as a labelled region (under the page tabs) with every step as a keyboard-reachable button', () => {
    view();
    const dialog = screen.getByRole('region', {
      name: /behind the scenes/i,
    });
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    const steps = within(dialog).getAllByRole('button', { name: /on your device|on Google Cloud/ });
    expect(steps).toHaveLength(13);
    expect(steps.every((s) => s.getAttribute('tabindex') === '0')).toBe(true);
    expect(document.body.style.overflow).toBe(''); // part of the page: it never locks the page's scrolling
  });

  it('closes with the Close button and with Escape, after fading out', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    view(true, onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Back to prototype' }));
    expect(screen.getByRole('region', { name: /behind the scenes/i }).className).toContain(
      'arch--out',
    ); // fading, not yet gone
    expect(onClose).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(400));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('region', { name: /behind the scenes/i }), {
      key: 'Escape',
    });
    act(() => void vi.advanceTimersByTime(400));
    expect(onClose).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('closes at once when the visitor asks for less motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }));
    const onClose = vi.fn();
    view(true, onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Back to prototype' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('describes a step on hover or focus, and keeps it open when chosen with Enter', () => {
    view();
    expect(screen.getByText(/Hover or focus a step/)).toBeTruthy();
    const model = screen.getByRole('button', { name: /^Sign model, on your device/ });
    fireEvent.focus(model);
    const card = screen.getByLabelText('About the chosen step');
    expect(within(card).getByText('Sign model')).toBeTruthy();
    expect(within(card).getByText('On your device')).toBeTruthy();
    expect(card.textContent).toMatch(/GRU/);
    fireEvent.blur(model);
    expect(screen.getByText(/Hover or focus a step/)).toBeTruthy();
    fireEvent.keyDown(model, { key: 'Enter' });
    fireEvent.blur(model);
    expect(model.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText(/Hover or focus a step/)).toBeNull();
    fireEvent.keyDown(model, { key: ' ' });
    expect(model.getAttribute('aria-pressed')).toBe('false');
  });

  it('says where the Gemini step runs, and is honest when the service is in test mode', () => {
    view();
    emit({ kind: 'service', mode: 'mock', modelId: 'mock', voices: 'mock' });
    expect(screen.getByText(/test mode: the cloud steps are simulated/)).toBeTruthy();
    fireEvent.focus(screen.getByRole('button', { name: /^Gemini, on Google Cloud/ }));
    expect(screen.getByLabelText('About the chosen step').textContent).toMatch(
      /no real Gemini is called/,
    );
  });

  it('updates the numbers and the feed from real events, and lights the step', () => {
    view();
    emit({ kind: 'device', sign: 'where', confidence: 0.91, ms: 14 });
    const stats = screen.getByLabelText('Live numbers');
    expect(within(stats).getByText('Signs named on device').nextSibling?.textContent).toBe('1');
    expect(
      within(screen.getByLabelText('Live feed')).getByText(/Sign “where” named on this device/),
    ).toBeTruthy();
    const model = screen.getByRole('button', { name: /^Sign model/ });
    expect(model.getAttribute('class')).toContain('arch-node--lit');
    expect(model.getAttribute('aria-label')).toContain('1 named');
  });

  it('sends dots along the route of a real event, coloured by the kind of data', () => {
    const { container } = view();
    emit({ kind: 'device', sign: 'yes', confidence: 0.9, ms: 10 });
    // device: hand points to the model, then the sign to the sentence step
    expect(container.querySelectorAll('circle.arch-packet--points')).toHaveLength(1);
    expect(container.querySelectorAll('circle.arch-packet--signs')).toHaveLength(1);
    emit({ kind: 'voice', voiceId: 'aria', ms: 500 });
    expect(container.querySelectorAll('circle.arch-packet--audio')).toHaveLength(1);
  });

  it('draws no dots for people who ask for less motion, but still lights the steps and fills the feed', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({
        matches: true,
        media: q,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    const { container } = view();
    emit({ kind: 'device', sign: 'yes', confidence: 0.9, ms: 10 });
    expect(container.querySelectorAll('circle.arch-packet')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^Sign model/ }).getAttribute('class')).toContain(
      'arch-node--lit',
    );
    expect(screen.getByLabelText('Live feed').textContent).toContain('named on this device');
  });

  it('plays a made-up sample run, clearly marked, through the whole pipeline', () => {
    vi.useFakeTimers();
    view();
    const play = screen.getByRole('button', { name: 'Play a sample' });
    fireEvent.click(play);
    expect(
      (screen.getByRole('button', { name: /Playing a sample/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    act(() => void vi.advanceTimersByTime(9_500));
    bus.flush();
    const feed = screen.getByLabelText('Live feed').textContent!;
    for (const part of [
      'named on this device',
      'Meeting summary updated',
      'written by Gemma',
      'Spoken aloud',
    ])
      expect(feed, part).toContain(part);
    // every line from the sample says so
    const lines = [...screen.getByLabelText('Live feed').querySelectorAll('li')];
    expect(lines.length).toBeGreaterThan(4);
    expect(lines.every((li) => li.textContent!.includes('(sample)'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Play a sample' })).toBeTruthy(); // ready to play again
  });

  it('stops a sample that is still playing when the view closes', () => {
    vi.useFakeTimers();
    const { rerender } = view();
    fireEvent.click(screen.getByRole('button', { name: 'Play a sample' }));
    rerender(<ArchitectureView bus={bus} open={false} onClose={() => {}} />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(bus.snapshot().feed).toEqual([]);
  });
});

describe('the voice check in the live view', () => {
  it('counts voice checks and says what Speech-to-Text heard, or that test mode checked nothing', () => {
    const real = describeEvent({
      kind: 'voice-check',
      heard: 'Hello there.',
      ms: 900,
      mode: 'google',
    });
    expect(real).toContain('Speech-to-Text heard “Hello there.”');
    const mock = describeEvent({ kind: 'voice-check', heard: 'x', ms: 1, mode: 'mock' });
    expect(mock).toContain('test mode');
    const stats = reduce(
      emptyStats(),
      { kind: 'voice-check', heard: 'Hello there.', ms: 900, mode: 'google' },
      1,
      () => 1,
    );
    expect(stats.voiceChecks).toBe(1);
    expect(stats.lastVoiceCheck).toMatchObject({ heard: 'Hello there.' });
    expect(apiName('api/voiceCheck')).toBe('Check the voice');
  });
});

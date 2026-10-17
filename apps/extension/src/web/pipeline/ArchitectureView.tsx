import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { apiName, type PipelineBus, type Stats } from './bus';
import { BADGES, CLOUD_ZONE_LOGO, LOGOS, WORDMARKS } from './logos';
import {
  CANVAS,
  EDGE_BY_ID,
  EDGES,
  KIND_LABEL,
  NODE_H,
  NODE_W,
  NODES,
  nodesFor,
  routeFor,
  type DataKind,
  type EdgeId,
  type IconKey,
  type NodeId,
  type PipelineNode,
  type Stamped,
} from './model';

/** The "behind the scenes" view: Ola's architecture, with the real data flowing through it as it happens. */

const LIT_MS = 1600;
const HOP_MS = 650;
const FRAME_DOT_EVERY_MS = 450;
const MAX_PACKETS = 60;

interface Packet {
  id: number;
  edge: EdgeId;
  back: boolean;
  /** performance.now() time at which it starts moving. */
  start: number;
  kind: DataKind;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const q = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(q.matches);
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** Original line icons (24 x 24 grid), drawn as strokes; a zero-length "h.01" segment is a dot. */
const ICONS: Record<IconKey, string> = {
  camera:
    'M4 8h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z M16 11l5-3v8l-5-3',
  points: 'M5 18l5-9 4 5 5-9 M5 18h.01 M10 9h.01 M14 14h.01 M19 5h.01',
  segment: 'M3 12h4l2-6 4 12 2-6h6',
  net: 'M6 6h.01 M6 12h.01 M6 18h.01 M12 9h.01 M12 15h.01 M18 12h.01 M6 6l6 3 M6 12l6-3 M6 12l6 3 M6 18l6-3 M12 9l6 3 M12 15l6-3',
  sentence: 'M4 7h16 M4 12h10 M4 17h13',
  captions:
    'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z M7 11h4 M13 11h4 M7 15h2 M11 15h6',
  context:
    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
  server: 'M4 5h16v5H4z M4 14h16v5H4z M7.5 7.5h.01 M7.5 16.5h.01',
  chip: 'M8 8h8v8H8z M10 3v3 M14 3v3 M10 18v3 M14 18v3 M3 10h3 M3 14h3 M18 10h3 M18 14h3',
  wave: 'M4 10v4 M8 6v12 M12 3v18 M16 7v10 M20 10v4',
  speaker: 'M4 10v4h4l5 4V6L8 10z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11',
  voice: 'M5 6h14 M5 12h14 M5 18h14 M9 4v4 M15 10v4 M8 16v4',
  listen: 'M7 10a5 5 0 1 1 10 0c0 3-2.2 3.8-2.2 6a2.8 2.8 0 0 1-5.6 0 M9.8 10a2.2 2.2 0 0 1 4.4 0',
};

/** Keeps a live figure short enough for the node. */
const fit = (text: string, max = 24) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const time = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The small live figure under a node's name. */
function badge(id: NodeId, s: Stats): string {
  switch (id) {
    case 'camera':
      return s.hands > 0 ? 'hands in view' : 'watching';
    case 'mediapipe':
      return `${s.fps} frames/s`;
    case 'segmenter':
      return s.signing ? 'a sign is happening' : 'waiting';
    case 'classifier':
      return fit(s.lastSign ? `${s.signs} named · “${s.lastSign.sign}”` : `${s.signs} named`);
    case 'sentence':
      return fit(
        s.lastSentence
          ? `${s.sentences} written · ${s.lastSentence.writer.split(',')[0]}`
          : `Gemma ${s.gemma}`,
      );
    case 'captions':
      return `${s.captions} lines`;
    case 'context':
      return s.lastContext ? `${s.contexts} summaries` : 'not summarised yet';
    case 'api':
      return `${s.apiCount} calls`;
    case 'gemini':
      return s.service?.mode === 'mock' ? 'test mode (mock)' : fit(s.service?.modelId ?? '');
    case 'tts':
      return s.service?.voices === 'mock' ? 'test tone (mock)' : `${s.voices} spoken`;
    case 'speaker':
      return s.lastVoice ? `last made in ${time(s.lastVoice.ms)}` : 'quiet';
    case 'profile':
      return s.lastVoice ? `last: ${s.lastVoice.voiceId}` : 'ready';
    case 'stt':
      return s.service?.voices === 'mock' ? 'test mode (mock)' : `${s.voiceChecks} checks`;
  }
}

/** A longer live line for the side panel. */
function liveLine(id: NodeId, s: Stats): string {
  switch (id) {
    case 'camera':
      return s.hands > 0
        ? `${s.hands} hand${s.hands > 1 ? 's' : ''} in view right now.`
        : 'No hands in view right now.';
    case 'mediapipe':
      return `${s.fps} frames a second are being analysed.`;
    case 'segmenter':
      return s.signing ? 'A sign is in progress.' : 'Waiting for the next sign.';
    case 'classifier':
      return s.lastSign
        ? `Last sign: “${s.lastSign.sign}”, ${Math.round(s.lastSign.confidence * 100)}% sure, named in ${time(s.lastSign.ms)}. ${s.unsure} not accepted so far.`
        : 'No sign named yet. Sign something, or press “Play a sample”.';
    case 'sentence':
      return s.lastSentence
        ? `Last sentence: “${s.lastSentence.sentence}”, written by ${s.lastSentence.writer} in ${time(s.lastSentence.ms)}. Gemma on this device: ${s.gemma}.`
        : `No sentence yet. Gemma on this device: ${s.gemma}.`;
    case 'captions':
      return `${s.captions} caption lines seen.`;
    case 'context':
      return s.lastContext
        ? `Last summary (${time(s.lastContext.ms)}): ${s.lastContext.summary}`
        : 'No summary yet. It needs “Use the meeting to word sentences” on in Ola’s settings.';
    case 'api':
      return s.apiCalls.length
        ? `Recent calls: ${s.apiCalls
            .slice(0, 3)
            .map((c) => `${apiName(c.path)} ${time(c.ms)}`)
            .join(', ')}.`
        : 'No calls yet.';
    case 'gemini':
      return s.service
        ? s.service.mode === 'mock'
          ? 'This copy of the demo is running in test mode, so no real Gemini is called: the answers are made up. A deployed copy calls Gemini.'
          : `Model: ${s.service.modelId}.`
        : 'Checking the service…';
    case 'tts':
      return s.service?.voices === 'mock'
        ? 'Test mode: a placeholder tone instead of a voice.'
        : s.lastVoice
          ? `Last voice: ${s.lastVoice.voiceId}, ready in ${time(s.lastVoice.ms)}.`
          : 'Nothing spoken yet.';
    case 'speaker':
      return s.voices
        ? `${s.voices} sentence${s.voices > 1 ? 's' : ''} spoken.`
        : 'Nothing spoken yet.';
    case 'profile':
      return s.lastVoice
        ? `Last sentence was spoken with the voice “${s.lastVoice.voiceId}”.`
        : 'Set it up in Ola’s Settings, under Voice.';
    case 'stt':
      return s.lastVoiceCheck
        ? s.lastVoiceCheck.mode === 'mock'
          ? 'Test mode: the voice check does not really listen.'
          : `Last check heard: “${s.lastVoiceCheck.heard || 'nothing'}” (${time(s.lastVoiceCheck.ms)}).`
        : 'No voice check yet. Use “What will people hear?” in the voice setup.';
  }
}

export interface ArchitectureViewProps {
  bus: PipelineBus;
  open: boolean;
  onClose(): void;
}

export function ArchitectureView({ bus, open, onClose }: ArchitectureViewProps) {
  const reduced = usePrefersReducedMotion();
  const [stats, setStats] = useState<Stats>(() => bus.snapshot());
  const [lit, setLit] = useState<Partial<Record<NodeId, number>>>({});
  const [now, setNow] = useState(() => Date.now());
  const [hover, setHover] = useState<NodeId | null>(null);
  const [pinned, setPinned] = useState<NodeId | null>(null);
  const [packets, setPackets] = useState<Packet[]>([]);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const circles = useRef(new Map<number, SVGCircleElement>());
  const paths = useRef(new Map<EdgeId, SVGPathElement>());
  const nextPacket = useRef(1);
  const lastFrameDot = useRef(0);
  const timers = useRef<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [closing, setClosing] = useState(false);
  const activeEdges = useMemo(() => new Set(packets.map((p) => p.edge)), [packets]);

  // Numbers and the feed: calm updates from the bus, only while the view is open.
  useEffect(() => {
    if (!open) return;
    setStats(bus.snapshot());
    const off = bus.subscribe(() => setStats(bus.snapshot()));
    const tick = window.setInterval(() => {
      setNow(Date.now());
      setStats(bus.snapshot());
    }, 500);
    return () => {
      off();
      window.clearInterval(tick);
    };
  }, [bus, open]);

  // Events: light up nodes and send dots along the route, straight away.
  useEffect(() => {
    if (!open) return;
    return bus.onEvent((e: Stamped, at: number) => {
      const nodes = nodesFor(e);
      if (nodes.length) {
        setLit((l) => ({ ...l, ...Object.fromEntries(nodes.map((n) => [n, at + LIT_MS])) }));
      }
      if (reduced) return;
      if (e.kind === 'frame') {
        const t = performance.now();
        if (t - lastFrameDot.current < FRAME_DOT_EVERY_MS) return;
        lastFrameDot.current = t;
      }
      const hops = routeFor(e);
      if (!hops.length) return;
      const t0 = performance.now();
      setPackets((p) =>
        [
          ...p,
          ...hops.map((h) => ({
            id: nextPacket.current++,
            edge: h.edge,
            back: !!h.back,
            start: t0 + h.delay,
            kind: EDGE_BY_ID[h.edge].kind,
          })),
        ].slice(-MAX_PACKETS),
      );
    });
  }, [bus, open, reduced]);

  // Move the dots: positions are set directly on the circles each frame (no React render per frame).
  useEffect(() => {
    if (!open || reduced || packets.length === 0) return;
    let raf = 0;
    const step = () => {
      const t = performance.now();
      let finished = false;
      for (const p of packets) {
        const c = circles.current.get(p.id);
        const path = paths.current.get(p.edge);
        const k = (t - p.start) / HOP_MS;
        if (k > 1) finished = true;
        if (!c) continue;
        if (k < 0 || k > 1) {
          c.setAttribute('opacity', '0');
          continue;
        }
        if (path && typeof path.getTotalLength === 'function') {
          const pt = path.getPointAtLength((p.back ? 1 - k : k) * path.getTotalLength());
          c.setAttribute('cx', String(pt.x));
          c.setAttribute('cy', String(pt.y));
        }
        c.setAttribute('opacity', String(Math.min(1, k * 6, (1 - k) * 6 + 0.2)));
      }
      if (finished)
        setPackets((all) => all.filter((p) => (performance.now() - p.start) / HOP_MS <= 1));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [open, reduced, packets]);

  // Focus: into the dialog when it opens, Escape closes, Tab stays inside.
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    setPlaying(false);
  }, []);
  useEffect(() => clearTimers, [clearTimers]);
  useEffect(() => {
    if (!open) clearTimers();
  }, [open, clearTimers]);

  /** A made-up run through the whole pipeline, clearly marked as a sample, so it can be seen without a camera. */
  const playSample = () => {
    clearTimers();
    setPlaying(true);
    const at = (ms: number, e: Stamped) =>
      timers.current.push(window.setTimeout(() => bus.emit({ ...e, simulated: true }), ms));
    for (let i = 0; i < 10; i++) at(i * 220, { kind: 'frame', hands: 2 });
    at(300, { kind: 'signing', on: true });
    at(1500, { kind: 'signing', on: false });
    at(1700, { kind: 'device', sign: 'where', confidence: 0.91, ms: 14 });
    at(3000, { kind: 'device', sign: 'time', confidence: 0.88, ms: 12 });
    at(3600, { kind: 'caption', speaker: 'Priya', text: 'The demo is on Friday at three.' });
    at(4400, {
      kind: 'context',
      summary: 'The team is planning a product demo for Friday at three.',
      ms: 1800,
      chars: 240,
    });
    at(6200, {
      kind: 'sentence',
      sentence: 'What time is the demo?',
      writer: 'Gemma, on this device',
      ms: 310,
    });
    at(7200, { kind: 'voice', voiceId: 'aria', ms: 640 });
    timers.current.push(window.setTimeout(() => setPlaying(false), 8800));
  };

  // Closing fades the view out, and the meeting screen back in, before the view is removed.
  useEffect(() => {
    if (open) setClosing(false);
  }, [open]);
  const requestClose = () => {
    if (reduced) return onClose();
    setClosing(true);
    document.body.classList.remove('arch-open');
    timers.current.push(window.setTimeout(onClose, 380));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      requestClose();
      return;
    }
    if (e.key !== 'Tab' || !dialog.current) return;
    const focusable = [
      ...dialog.current.querySelectorAll<HTMLElement>('button, [tabindex="0"], a[href]'),
    ].filter((el) => !el.hasAttribute('disabled'));
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const selected = pinned ?? hover;
  const detail: PipelineNode | undefined = useMemo(
    () => NODES.find((n) => n.id === selected),
    [selected],
  );

  if (!open) return null;

  const isLit = (id: NodeId) => (lit[id] ?? 0) > now;
  const serviceLine = stats.service
    ? stats.service.mode === 'mock'
      ? 'This copy runs in test mode: the cloud steps are simulated, not real Gemini.'
      : `Live service · model ${stats.service.modelId} · voices ${stats.service.voices}`
    : 'Checking the service…';

  return (
    <div
      className={`arch${closing ? ' arch--out' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="arch-title"
      ref={dialog}
      onKeyDown={onKeyDown}
    >
      <header className="arch__head">
        <div>
          <h2 id="arch-title">
            <span className="arch__live-pill">
              <span className="arch__live-dot" aria-hidden="true" />
              Live
            </span>
            Behind the scenes
          </h2>
          <p>Each glowing dot is real data moving between Ola’s steps. Sign, or play a sample.</p>
        </div>
        <div className="arch__actions">
          <button type="button" className="arch__btn" onClick={playSample} disabled={playing}>
            {playing ? 'Playing a sample…' : 'Play a sample'}
          </button>
          <button
            type="button"
            className="arch__btn arch__btn--close"
            ref={closeButton}
            onClick={requestClose}
          >
            Close
          </button>
        </div>
      </header>

      <div className="arch__body">
        <section className="arch__diagram" aria-label="Architecture diagram">
          <svg
            viewBox={`0 0 ${CANVAS.w} ${CANVAS.h}`}
            className="arch__svg"
            role="group"
            aria-label="How Ola works, step by step"
          >
            <defs>
              {(Object.keys(KIND_LABEL) as DataKind[]).map((k) => (
                <marker
                  key={k}
                  id={`arch-arrow-${k}`}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M0 1L9 5L0 9z" className={`arch-fill arch-fill--${k}`} />
                </marker>
              ))}
            </defs>

            <rect
              x="20"
              y="56"
              width="1066"
              height="816"
              rx="26"
              className="arch-zone arch-zone--device"
            />
            <rect
              x="1130"
              y="56"
              width="290"
              height="816"
              rx="26"
              className="arch-zone arch-zone--cloud"
            />
            <text x="48" y="92" className="arch-zone__label">
              YOUR BROWSER
            </text>
            <text x="48" y="112" className="arch-zone__sub">
              private, unless an arrow crosses the line
            </text>
            <circle cx="1167" cy="86" r="11" className="arch-logo-disc" />
            <image
              href={CLOUD_ZONE_LOGO.src}
              x="1159"
              y="78"
              width="16"
              height="16"
              aria-hidden="true"
            />
            <text x="1188" y="92" className="arch-zone__label">
              GOOGLE CLOUD
            </text>
            <text x="1156" y="112" className="arch-zone__sub">
              Cloud Run · Vertex AI · TTS
            </text>

            {EDGES.map((e) => (
              <g
                key={e.id}
                className={`arch-edge arch-edge--${e.kind}${e.optional ? ' arch-edge--optional' : ''}${
                  activeEdges.has(e.id) ? ' arch-edge--on' : ''
                }`}
              >
                <path
                  d={e.d}
                  className="arch-edge__line"
                  ref={(el) => {
                    if (el) paths.current.set(e.id, el);
                  }}
                  markerEnd={`url(#arch-arrow-${e.kind})`}
                />
                <path d={e.d} className="arch-edge__flow" />
                <text
                  x={e.lx}
                  y={e.ly}
                  textAnchor={e.anchor ?? 'middle'}
                  className="arch-edge__label"
                >
                  {e.label}
                </text>
              </g>
            ))}

            {NODES.map((n) => (
              <g
                key={n.id}
                transform={`translate(${n.x - NODE_W / 2} ${n.y - NODE_H / 2})`}
                className={`arch-node arch-node--${n.zone}${isLit(n.id) ? ' arch-node--lit' : ''}${
                  selected === n.id ? ' arch-node--selected' : ''
                }`}
                role="button"
                tabIndex={0}
                aria-pressed={pinned === n.id}
                aria-label={`${n.title}, ${n.zone === 'device' ? 'on your device' : 'on Google Cloud'}: ${badge(n.id, stats)}`}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(n.id)}
                onBlur={() => setHover(null)}
                onClick={() => setPinned((p) => (p === n.id ? null : n.id))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setPinned((p) => (p === n.id ? null : n.id));
                  }
                }}
              >
                <rect width={NODE_W} height={NODE_H} rx="16" className="arch-node__box" />
                <circle
                  cx="34"
                  cy="31"
                  r="17"
                  className={`arch-node__disc${LOGOS[n.id] ? ' arch-node__disc--logo' : ''}`}
                />
                {LOGOS[n.id] ? (
                  <image
                    href={LOGOS[n.id]!.src}
                    x="22"
                    y="19"
                    width="24"
                    height="24"
                    aria-hidden="true"
                  />
                ) : (
                  <path
                    d={ICONS[n.icon]}
                    transform="translate(22 19)"
                    className="arch-node__icon"
                    fill="none"
                  />
                )}
                <text x="62" y="29" className="arch-node__title">
                  {n.title}
                </text>
                {WORDMARKS[n.id] ? (
                  <g aria-hidden="true">
                    <rect x="60" y="34" width="104" height="18" rx="9" className="arch-logo-pill" />
                    <svg
                      x="68"
                      y="37"
                      width="88"
                      height="12"
                      viewBox={WORDMARKS[n.id]!.crop.join(' ')}
                      preserveAspectRatio="xMidYMid meet"
                    >
                      <image href={WORDMARKS[n.id]!.src} width="960" height="540" />
                    </svg>
                  </g>
                ) : (
                  <text x="62" y="46" className="arch-node__sub">
                    {n.subtitle}
                  </text>
                )}
                {BADGES[n.id] && (
                  <g aria-hidden="true">
                    <circle cx={NODE_W - 20} cy="20" r="11" className="arch-logo-disc" />
                    <image href={BADGES[n.id]!.src} x={NODE_W - 28} y="12" width="16" height="16" />
                  </g>
                )}
                <line x1="16" y1="60" x2={NODE_W - 16} y2="60" className="arch-node__rule" />
                <circle cx="21" cy="74" r="3" className="arch-node__dot" />
                <text x="31" y="78" className="arch-node__badge">
                  {badge(n.id, stats)}
                </text>
              </g>
            ))}

            {packets.map((p) => (
              <circle
                key={p.id}
                r="5"
                cx="-20"
                cy="-20"
                opacity="0"
                className={`arch-packet arch-packet--${p.kind}`}
                ref={(el) => {
                  if (el) circles.current.set(p.id, el);
                  else circles.current.delete(p.id);
                }}
              />
            ))}
          </svg>

          <ul className="arch__legend" aria-label="Key">
            {(Object.keys(KIND_LABEL) as DataKind[]).map((k) => (
              <li key={k}>
                <span className={`arch__swatch arch-fill--${k}`} aria-hidden="true" />
                {KIND_LABEL[k]}
              </li>
            ))}
            <li>
              <span className="arch__swatch arch__swatch--dashed" aria-hidden="true" />
              dashed: only when a setting is on
            </li>
          </ul>
        </section>

        <aside className="arch__side">
          <section className="arch__card" aria-live="polite" aria-label="About the chosen step">
            {detail ? (
              <>
                <h3>
                  {detail.title}
                  <span className={`arch__where arch__where--${detail.zone}`}>
                    {detail.zone === 'device' ? 'On your device' : 'On Google Cloud'}
                  </span>
                </h3>
                <p>{detail.what}</p>
                <p className="arch__data">{detail.data}</p>
                <p className="arch__live">{liveLine(detail.id, stats)}</p>
              </>
            ) : (
              <p className="arch__hint">
                Hover or focus a step to read what it does, where it runs and what data it sees.
                Press Enter on it to keep it open.
              </p>
            )}
          </section>

          <section className="arch__card" aria-label="Live numbers">
            <h3>Live numbers</h3>
            <p className="arch__service">{serviceLine}</p>
            <dl className="arch__stats">
              <div>
                <dt>Hand tracking</dt>
                <dd>{stats.fps} frames/s</dd>
              </div>
              <div>
                <dt>Signs named on device</dt>
                <dd>{stats.signs}</dd>
              </div>
              <div>
                <dt>Not accepted (unsure)</dt>
                <dd>{stats.unsure}</dd>
              </div>
              <div>
                <dt>Gemini sign checks</dt>
                <dd>{stats.cloudChecks}</dd>
              </div>
              <div>
                <dt>Sentences written</dt>
                <dd>{stats.sentences}</dd>
              </div>
              <div>
                <dt>Spoken aloud</dt>
                <dd>{stats.voices}</dd>
              </div>
              <div>
                <dt>Voice checks</dt>
                <dd>{stats.voiceChecks}</dd>
              </div>
              <div>
                <dt>Meeting summaries</dt>
                <dd>{stats.contexts}</dd>
              </div>
              <div>
                <dt>API calls</dt>
                <dd>{stats.apiCount}</dd>
              </div>
            </dl>
          </section>

          <section className="arch__card arch__card--feed" aria-label="Live feed">
            <h3>Live feed</h3>
            <ol className="arch__feed" role="log" aria-live="off">
              {stats.feed.length === 0 ? (
                <li className="arch__hint">Nothing yet. Sign, or press “Play a sample”.</li>
              ) : (
                stats.feed.slice(0, 14).map((l) => (
                  <li key={l.id} className={l.simulated ? 'arch__feed--sample' : undefined}>
                    <time>{clock(l.at)}</time> {l.text}
                  </li>
                ))
              )}
            </ol>
          </section>

          <p className="arch__credit">
            The sign model learned from PopSign ASL (CC BY 4.0, Georgia Tech and the Deaf
            Professional Arts Network). Hand tracking: MediaPipe. Sentences: Gemma and Gemini.
            Voices: Google Cloud.
          </p>
        </aside>
      </div>
    </div>
  );
}

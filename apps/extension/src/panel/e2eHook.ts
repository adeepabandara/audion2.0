import type { LandmarkFrame } from '../lib/landmarks';
import { phaseOf, type MachineEvent, type MachineState } from './machine';
import type { AudionSession } from './session';

/**
 * Test-only hook, compiled in ONLY when the extension is built with AUDION_E2E=1 (never in a release build; the
 * manifest check fails a release bundle that contains it). A fake camera shows no hands, so end-to-end tests feed
 * synthetic landmarks through here, and read the machine state back from a DOM attribute.
 *
 *   window.dispatchEvent(new CustomEvent('audion:e2e-frame', { detail: JSON.stringify(frame) }))
 *   window.dispatchEvent(new CustomEvent('audion:e2e-dispatch', { detail: JSON.stringify(machineEvent) }))
 *   window.dispatchEvent(new CustomEvent('audion:e2e-speak')) // same as pressing Speak
 *   document.documentElement.dataset.audionState  // JSON summary of the state
 */
export const E2E_FRAME_EVENT = 'audion:e2e-frame';
export const E2E_DISPATCH_EVENT = 'audion:e2e-dispatch';
export const E2E_SPEAK_EVENT = 'audion:e2e-speak';

export function summarise(s: MachineState) {
  return {
    phase: phaseOf(s),
    on: s.on,
    chips: s.chips.map((c) => `${c.sign}:${c.state}`),
    problems: s.problems,
    sentence: s.sentence,
    caption: s.caption,
    speaking: s.speaking,
    micMuted: s.micMuted,
    inFlight: s.inFlight,
    notice: s.notice,
  };
}

export function installE2eHook(session: AudionSession, win: Window = window): () => void {
  session.setExternalFrames(true); // the real capture loop must not interleave its own (hand-less) frames
  const onFrame = (e: Event) =>
    void session.tick(JSON.parse((e as CustomEvent<string>).detail) as LandmarkFrame);
  const onDispatch = (e: Event) =>
    session.dispatch(JSON.parse((e as CustomEvent<string>).detail) as MachineEvent);
  const onSpeak = () => void session.speakNow();
  const publish = (s: MachineState) =>
    win.document.documentElement.setAttribute('data-audion-state', JSON.stringify(summarise(s)));
  win.addEventListener(E2E_FRAME_EVENT, onFrame);
  win.addEventListener(E2E_DISPATCH_EVENT, onDispatch);
  win.addEventListener(E2E_SPEAK_EVENT, onSpeak);
  const off = session.subscribe(publish);
  publish(session.getState());
  return () => {
    win.removeEventListener(E2E_FRAME_EVENT, onFrame);
    win.removeEventListener(E2E_DISPATCH_EVENT, onDispatch);
    win.removeEventListener(E2E_SPEAK_EVENT, onSpeak);
    off();
  };
}

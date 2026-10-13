import { useSyncExternalStore } from 'react';
import type { MachineState } from './machine';
import type { AudionSession } from './session';

export function useSessionState(session: AudionSession): MachineState {
  return useSyncExternalStore(session.subscribe, session.getState);
}

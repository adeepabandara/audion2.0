import { IframeTracker } from '../lib/trackerClient';
import { getSettingsStore } from '../lib/settings';
import { AudionSession, defaultDeps, type SessionDeps } from './session';

/** The real session: MediaPipe in the tracker iframe, settings read live from the settings store. */
export function createDefaultSession(
  trackerUrl: string,
  mountInto?: Node,
  overrides: Partial<SessionDeps> = {},
): AudionSession {
  const deps = defaultDeps(() => new IframeTracker(trackerUrl, mountInto));
  deps.settings = () => {
    const {
      holdTimeMs,
      pauseMs,
      speakMode,
      voiceId,
      speed,
      postToChat,
      monitorVoice,
      fastSigns,
      cloudCheck,
      meetingContext,
      language,
    } = getSettingsStore().useStore.getState().settings;
    return {
      holdTimeMs,
      pauseMs,
      speakMode,
      voiceId,
      speed,
      postToChat,
      monitorVoice,
      fastSigns,
      cloudCheck,
      meetingContext,
      language,
    };
  };
  return new AudionSession({ ...deps, ...overrides });
}

import { IframeTracker } from '../lib/trackerClient';
import { getSettingsStore } from '../lib/settings';
import { AudionSession, defaultDeps } from './session';

/** The real session: MediaPipe in the tracker iframe, settings read live from the settings store. */
export function createDefaultSession(trackerUrl: string, mountInto?: Node): AudionSession {
  const deps = defaultDeps(() => new IframeTracker(trackerUrl, mountInto));
  deps.settings = () => {
    const { holdTimeMs, pauseMs, speakMode, voiceId, speed, postToChat } =
      getSettingsStore().useStore.getState().settings;
    return { holdTimeMs, pauseMs, speakMode, voiceId, speed, postToChat };
  };
  return new AudionSession(deps);
}

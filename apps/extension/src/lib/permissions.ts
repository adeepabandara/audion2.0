import { classifyMediaError, type CameraProblem } from './camera';

export type PermissionStatus = 'granted' | 'prompt' | 'denied' | 'unknown';
export type MediaKind = 'camera' | 'microphone';

/** Current state without prompting. Chrome supports the camera/microphone names; others report 'unknown'. */
export async function queryPermission(kind: MediaKind): Promise<PermissionStatus> {
  try {
    const status = await navigator.permissions.query({ name: kind as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

/** Triggers the real browser prompt, then immediately releases the device. */
export async function requestMedia(
  kind: MediaKind,
): Promise<{ ok: true } | { ok: false; problem: CameraProblem }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === 'camera' ? { video: true } : { audio: true },
    );
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (e) {
    return { ok: false, problem: classifyMediaError(e) };
  }
}

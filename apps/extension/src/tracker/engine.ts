import { HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { BodyPoint, Hand } from '../lib/landmarks';

/**
 * Wraps MediaPipe Hand Landmarker and Pose Landmarker (lite). Runs inside the extension-origin tracker page.
 * The pose points tell the sign classifier where the hands are on the body; if the pose model cannot load, hand
 * tracking still works and the classifier simply gets no body numbers.
 */
export async function createEngine(base: string): Promise<{
  detect(bitmap: ImageBitmap, t: number): { hands: Hand[]; pose: BodyPoint[] | null };
  delegate: 'GPU' | 'CPU';
}> {
  // SIMD runtime only (Chrome 91+); copied into wasm/ at build time.
  const fileset = {
    wasmLoaderPath: `${base}wasm/vision_wasm_internal.js`,
    wasmBinaryPath: `${base}wasm/vision_wasm_internal.wasm`,
  };
  // The same settings the training data was extracted with (tools/signclf/extract_pose.py).
  const makeHands = (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  const makePose = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}models/pose_landmarker_lite.task`, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  let delegate: 'GPU' | 'CPU' = 'GPU';
  let landmarker: HandLandmarker;
  try {
    landmarker = await makeHands('GPU');
  } catch {
    delegate = 'CPU';
    landmarker = await makeHands('CPU');
  }
  let poser: PoseLandmarker | null = null;
  try {
    poser = await makePose(delegate).catch(() => makePose('CPU'));
  } catch (e) {
    console.warn('tracker: pose model unavailable, signs are named from the hands only', e);
  }

  let lastTs = 0;
  return {
    delegate,
    detect(bitmap, t) {
      // MediaPipe requires strictly increasing timestamps.
      const ts = Math.max(Math.round(t), lastTs + 1);
      lastTs = ts;
      const res = landmarker.detectForVideo(bitmap, ts);
      const hands = res.landmarks.map((lm, i) => {
        const label = res.handedness[i]?.[0]?.categoryName;
        return {
          landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })),
          // The model assumes a mirrored selfie image; we send the unmirrored frame, so the label is flipped.
          handedness: label === 'Left' ? 'Right' : label === 'Right' ? 'Left' : 'Unknown',
        } satisfies Hand;
      });
      let pose: BodyPoint[] | null = null;
      if (poser) {
        try {
          const body = poser.detectForVideo(bitmap, ts).landmarks[0];
          pose = body
            ? body.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 }))
            : null;
        } catch (e) {
          console.warn('tracker: pose detect failed', e);
        }
      }
      return { hands, pose };
    },
  };
}

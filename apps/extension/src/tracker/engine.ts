import { HandLandmarker } from '@mediapipe/tasks-vision';
import type { Hand } from '../lib/landmarks';

/** Wraps MediaPipe Hand Landmarker. Runs inside the extension-origin tracker page. */
export async function createEngine(base: string): Promise<{
  detect(bitmap: ImageBitmap, t: number): Hand[];
  delegate: 'GPU' | 'CPU';
}> {
  // SIMD runtime only (Chrome 91+); copied into wasm/ at build time.
  const fileset = {
    wasmLoaderPath: `${base}wasm/vision_wasm_internal.js`,
    wasmBinaryPath: `${base}wasm/vision_wasm_internal.wasm`,
  };
  const make = (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  let delegate: 'GPU' | 'CPU' = 'GPU';
  let landmarker: HandLandmarker;
  try {
    landmarker = await make('GPU');
  } catch {
    delegate = 'CPU';
    landmarker = await make('CPU');
  }

  let lastTs = 0;
  return {
    delegate,
    detect(bitmap, t) {
      // MediaPipe requires strictly increasing timestamps.
      const ts = Math.max(Math.round(t), lastTs + 1);
      lastTs = ts;
      const res = landmarker.detectForVideo(bitmap, ts);
      return res.landmarks.map((lm, i) => {
        const label = res.handedness[i]?.[0]?.categoryName;
        return {
          landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })),
          // The model assumes a mirrored selfie image; we send the unmirrored frame, so the label is flipped.
          handedness: label === 'Left' ? 'Right' : label === 'Right' ? 'Left' : 'Unknown',
        } satisfies Hand;
      });
    },
  };
}

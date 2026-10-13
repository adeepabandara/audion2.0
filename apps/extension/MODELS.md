# Bundled models

`hand_landmarker.task` — MediaPipe Hand Landmarker (float16), Apache-2.0, Google.
Source: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
SHA-256: fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1 (7,819,105 bytes)

Bundled so the extension loads no remote code or models (MV3). Re-fetch and verify with `scripts/fetch-hand-model.sh` (model lives in `public/models/`).
The MediaPipe WASM runtime is copied from `@mediapipe/tasks-vision` into `wasm/` at build time (see wxt.config.ts).

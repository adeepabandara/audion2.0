#!/usr/bin/env bash
# Re-download the MediaPipe hand and pose models and verify them against the pinned checksums.
set -euo pipefail
cd "$(dirname "$0")/.."
fetch() {
  curl -fL -o "public/models/$1" "$2"
  echo "$3  public/models/$1" | shasum -a 256 -c -
}
fetch hand_landmarker.task \
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" \
  fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1
fetch pose_landmarker_lite.task \
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" \
  59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a

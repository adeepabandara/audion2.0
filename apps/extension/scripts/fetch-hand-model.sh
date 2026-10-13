#!/usr/bin/env bash
# Re-download the MediaPipe hand model and verify it against the pinned checksum.
set -euo pipefail
cd "$(dirname "$0")/.."
URL="https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
SHA="fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"
curl -fL -o public/models/hand_landmarker.task "$URL"
echo "$SHA  public/models/hand_landmarker.task" | shasum -a 256 -c -

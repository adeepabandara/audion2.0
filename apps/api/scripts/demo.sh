#!/usr/bin/env bash
# M1 demo: start the API in mock mode and walk session -> recognize -> compose -> speak with curl.
# Usage: apps/api/scripts/demo.sh        (needs `pnpm build` first)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-$(node -e "require('net').createServer().listen(0,function(){console.log(this.address().port);this.close()})")}"
OUT="$(mktemp -d)"
MOCK=1 PORT="$PORT" LOG_LEVEL=warn node dist/server.js &
PID=$!
trap 'kill $PID 2>/dev/null; rm -rf "$OUT"' EXIT
for _ in $(seq 1 50); do curl -sf "localhost:$PORT/healthz" | grep -q '"mode":"mock"' && break; sleep 0.1; done
kill -0 $PID 2>/dev/null || { echo "API failed to start on port $PORT"; exit 1; }
B="localhost:$PORT"

echo "== healthz";  curl -s "$B/healthz"; echo
TOKEN=$(curl -s -X POST "$B/v1/session" -H 'content-type: application/json' \
  -d "{\"installId\":\"$(uuidgen | tr A-Z a-z)\"}" | sed -E 's/.*"token":"([^"]+)".*/\1/')
echo "== session token: ${TOKEN:0:20}..."

echo "== recognize x3 (fake bytes; mock ignores content)"
head -c 2000 /dev/urandom > "$OUT/clip.webm"
for _ in 1 2 3; do
  curl -s -X POST "$B/v1/recognize" -H "authorization: Bearer $TOKEN" \
    -F mime=video/webm -F durationMs=1800 -F "clip=@$OUT/clip.webm;type=video/webm"; echo
done

echo "== compose"
curl -s -X POST "$B/v1/compose" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"signs":["hello","please","wait"]}'; echo
curl -s -X POST "$B/v1/compose" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"signs":[]}'; echo

echo "== speak"
curl -s -X POST "$B/v1/speak" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"text":"Hello, please wait.","voiceId":"aria","speed":1}' -o "$OUT/speech.wav" -w 'status=%{http_code} type=%{content_type} bytes=%{size_download}\n'
echo "(play with: afplay <file>; this demo deletes its temp dir on exit)"

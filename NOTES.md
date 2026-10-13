# Audion

Chrome extension (MV3) for Google Meet plus a small backend. A Deaf or hard-of-hearing ASL signer signs to their webcam; Audion recognises the signs, builds an English sentence, shows it as a caption and speaks it into the call as the signer's voice.

## Working rules

- Work one milestone at a time (M0–M8, below). Each ends with passing tests, a demo script, a commit, then STOP and report.
- Small, typed, tested modules. No placeholder code that pretends to work. If a real Google Cloud call is unavailable, use mock mode (`MOCK=1`) and say so.
- Ask the user before: adding a dependency over 100 kB gzipped, changing architecture, or anything touching Google Cloud resources, IAM or billing.
- Update this file when decisions change. Keep it under 300 lines.

## Hard constraints (never violate)

- **No secrets in the repo.** No API keys, service-account JSON, or committed `.env`. Use `.env.example`. The API uses Application Default Credentials (Cloud Run service account). Never create or download service-account keys.
- **Never store user video.** Frames/clips live in memory only and are discarded. Never written to disk, Cloud Storage, logs or analytics. Logs hold request IDs, timings, sign labels and error codes only.
- **Never start Vertex AI tuning jobs** or change GCP IAM, billing or project settings from code/scripts. The user tunes.
- No PopSign data or any video in git.
- Accessibility is a requirement: WCAG AA, full keyboard use, visible focus, `aria-live` for status and captions, never colour alone (icon + text for every state), respect `prefers-reduced-motion`.

## Product

- Meet only (`https://meet.google.com/*`), ASL, webcam. English output only (v1).
- Vocabulary (22): hello, bye, yes, no, please, thankyou, wait, why, who, where, now, later, tomorrow, time, finish, think, look, listen, talk, fine, same, not. Source of truth: `packages/shared/src/signs.ts`.
- The model recognises ONE isolated sign per short clip. Sentences come from the compose step.
- Baseline (untuned Gemini 3.5 Flash) accuracy is 26.2%; the tuned model is plugged in via config. Model IDs are config values, never code.
- Brand: primary `#0F766E` (teal), highlight `#2DD4BF` on dark surfaces. Never use primary as text on dark.
- Privacy promise: "Your video is processed to recognize signs and never stored."
- Other participants cannot see Audion's local overlay. They hear the voice (so Meet's captions caption it) and optionally get a Meet chat post (setting, default OFF). Never claim others see the overlay.

## Architecture

pnpm monorepo, three kinds of unit: extension, API (Cloud Run), shared.

```
Google Meet tab
  Content script (isolated): Audion panel (Shadow DOM, React), camera preview,
    hand tracking (Worker), segmenter, clip recorder, local caption bar
  MAIN-world script (document_start): wraps getUserMedia so the outgoing mic
    track is a Web Audio mixer (real mic + Audion voice)
  Service worker: session, settings, API client, offline queue, in-memory transcript
        | HTTPS (short clips only)
        v
  Audion API (Fastify, Cloud Run): POST /v1/session, /v1/recognize, /v1/compose, /v1/speak, GET /healthz
        v
  Vertex AI: tuned Gemini 3.5 Flash (recognise), Gemini text model (compose); Cloud TTS (speak)
```

One sentence: panel opens camera -> MediaPipe Hand Landmarker (local, Worker) drives preview dots and the segmentation state machine -> clip (1–3 s WebM) to `/v1/recognize` -> chip (low confidence shows confirm popover) -> after 1.5 s pause or Speak, chips go to `/v1/compose` -> sentence (auto-speak or confirm-first) -> `/v1/speak` audio -> mixer plays into outgoing mic and caption bar shows text.

Repo layout:

```
apps/extension  (src/background, content, inject, panel, pages, lib; public/models)
apps/api        (src/routes, services, config.ts; Dockerfile)
packages/shared (zod schemas, types, signs, voices, constants)
packages/ui     (tokens, components, Storybook)
tools/eval      (offline eval over test.jsonl)
tools/fake-meet (local page imitating a Meet call)
```

## Stack (ask before changing)

- pnpm workspaces, TypeScript strict, ESLint, Prettier. Node >= 20.
- Extension: Manifest V3 via **WXT**, React 18, Tailwind with CSS-variable tokens, Zustand, Radix UI. Panel in a Shadow DOM root. Panel state machine = typed reducer (no XState).
- Hand tracking: `@mediapipe/tasks-vision`, WASM + model bundled (no remote code).
- Audio: Web Audio (`AudioContext`, `MediaStreamAudioDestinationNode`).
- API: Fastify, zod (schemas from `@audion/shared`), `@google/genai` (Vertex), `@google-cloud/text-to-speech`, Pino with redaction, non-root Dockerfile.
- Tests: Vitest, Playwright (Chromium fake camera), msw. Storybook with axe.

## API contract

JSON except where noted. HTTPS only. CORS allow-list = extension origin only (calls come from the service worker); `meet.google.com` is NOT allowed.

- `POST /v1/session` -> `{ token, expiresInSec }`. JWT, 15 min, anonymous install UUID. Rate limited per install ID and per IP.
- `POST /v1/recognize` multipart (`clip` <= 2 MB, <= 5 s, field `mime`) -> `{ sign, confidence|null, alternatives[], latencyMs }`. `sign` is a vocab word or `"unknown"`. Clip goes to Vertex as inline data, never stored.
- `POST /v1/compose` `{ signs: string[], tone?: "neutral"|"polite" }` -> `{ sentence }`. Only minimum function words added; never new facts or content words. Empty `signs` -> 400.
- `POST /v1/speak` `{ text, voiceId, speed 0.75–1.5 }` -> streamed `audio/mpeg`. Four voices (2F, 2M, en-US) in `shared`.
- `GET /healthz` -> `{ ok: true, mode: "live"|"mock" }`.
- Errors: `{ error: { code, message, retryable } }`, codes `RATE_LIMITED, CLIP_TOO_LARGE, MODEL_UNAVAILABLE, BAD_REQUEST, UNAUTHENTICATED`.

## Model usage

- Recognition prompt is the EXACT training prompt (`RECOGNIZE_PROMPT` in shared). Single user turn with the video, temperature 0. Do not list the vocabulary. Normalise answer (`normaliseSign`).
- Confidence from `responseLogprobs` top candidates of the first answer token if supported; else `confidence: null`. Never invent numbers.
- Base model: Vertex global endpoint, `maxOutputTokens >= 2048` (thinking tokens). Tuned model: own endpoint resource in `us-central1`. All config:

```
GCP_PROJECT=audion-511503
RECOGNIZE_MODEL / RECOGNIZE_LOCATION / COMPOSE_MODEL / COMPOSE_LOCATION
CONFIDENCE_THRESHOLD=0.5   MOCK=0
```

- Verify tuned-model resource name/location format against current Google docs before coding the client; ask the user if unsure.
- Compose prompt = `COMPOSE_SYSTEM_PROMPT` in shared with few-shot examples (`[hello, please, wait]` -> `Hello, please wait.`). A guard rejects output words not derivable from the glosses.

## Extension internals

- All Meet DOM access lives in `lib/meetDom.ts` (defensive selectors, feature detection). If the control bar is missing, dock bottom-right.
- Camera only after the user turns Audion On. 640x480@30; tracking ~15–20 fps in a Worker. States idle -> seeing -> signing -> holding -> clip-ready.
- Segmenter: pure function over landmark frames. End after 400 ms below speed threshold or hands leave. Discard < 0.6 s or > 4 s. Thresholds in settings.
- Recorder: MediaRecorder with pre-roll, WebM, 480p, memory only.
- Voice into Meet: MAIN-world script patches `getUserMedia`; typed, origin-checked `postMessage` protocol; Mute switch; Off restores plain mic. Limits: only streams requested after install; user may need to reload Meet once.
- Settings in `chrome.storage.sync`. No video/transcript stored; transcript is in service-worker memory, cleared on summary close or tab close.
- Panel state machine: off -> starting -> ready -> seeing -> signing -> recognising -> chips -> composing -> sentence -> speaking -> ready; orthogonal errors lowLight, handsOut, notRecognised, offline, cameraBlocked. Each state has icon, label and aria-live text.

## Security and privacy

- Extension permissions minimal: `storage`, host permission for `https://meet.google.com/*` and the API origin. No remote code. Strict CSP.
- API: zod on every input, size limits, per-token and per-IP rate limits, no request-body logging, Pino redaction, security headers, CORS allow-list. Least-privilege service account (Vertex AI User, Text-to-Speech).
- Tokens short-lived and signed; install ID is a random UUID.
- An automated test must fail if any code path writes clip bytes to disk or logs them.
- About section must credit PopSign ASL v1.0 (CC BY 4.0, Georgia Tech and Deaf Professional Arts Network).
- Dependencies pinned; `pnpm audit` in CI.

## Mock mode and tooling

- `MOCK=1`: scripted recogniser (cycles vocab, configurable low-confidence rate), rule-based composer, bundled audio sample. Extension works end to end with no Google Cloud.
- `tools/fake-meet`: local Meet imitation for dev and e2e. `tools/eval`: runs labelled `test.jsonl` through `/v1/recognize`, prints accuracy and confusions.

## Milestones

M0 foundations · M1 API + mock + fake-meet · M2 design system/Storybook · M3 onboarding pages · M4 panel + pill + settings + signs sheet · M5 camera, tracking, segmenter, recorder, chips, errors · M6 compose, speak, voice injection, captions, summary · M7 live Vertex mode, eval, Cloud Run files · M8 tuned model, tuning of thresholds, hardening, e2e, docs.

## Commands

`pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm check` (all four)

## Decisions log

- Extension build tool: WXT (MV3 first-class, MAIN-world content scripts at document_start).
- Meet chat posting default OFF. English only v1.
- Working repo root: `Test/audion/`. The sibling `Test/signvoice/` is an earlier Python benchmark project and is unrelated; do not modify it.
- Mock `/v1/speak` returns a generated tone as `audio/wav` (not mp3); the extension must decode via `decodeAudioData`, which sniffs format. Live mode returns `audio/mpeg`.
- `/v1/recognize` accepts an optional `durationMs` field; the API rejects clips over 5 s with `CLIP_TOO_LARGE`.
- `/v1/session` body is `{ installId: uuid }`. `ALLOWED_ORIGINS` is a comma list; `*` allows all (dev only). Any request with a disallowed `Origin` (incl. meet.google.com) is rejected 401.
- `/v1/compose` rejects non-vocabulary glosses with 400, and falls back to the rule-based composer if a model sentence fails the grounding guard (`apps/api/src/services/composeGuard.ts`).
- Rate limiting is an in-memory fixed window (per instance). Fine for demo traffic; revisit before scaling Cloud Run beyond one instance.
- Logs: Pino redacts Authorization/cookie, including the multipart plugin's trace-level header log (found by `privacy.test.ts`).
- Demo: `pnpm build && apps/api/scripts/demo.sh`. Fake Meet: `pnpm --filter @audion/fake-meet dev` (http://localhost:4173).

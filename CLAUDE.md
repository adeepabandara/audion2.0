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
- `packages/ui` is consumed as TS source (`@audion/ui`, CSS via `@audion/ui/styles.css`). Plain CSS with `--au-*` tokens on `.au-root`, not Tailwind (approved but unnecessary here: one compiled stylesheet drops cleanly into a Shadow root). Tailwind may still be used for extension pages.
- Theme: `<ThemeRoot theme="system|light|dark">`. Overlays (Popover, Drawer, Tooltip) go through `ThemedPortal`, which re-wraps content in `.au-root`, so tokens work when portaled. Inside the Shadow DOM pass `portalContainer` (an element in the shadow root).
- Token colours: error text on dark is `#F87171` (`#EF4444` fails AA on raised surfaces). Danger buttons use a separate solid `--au-danger #B91C1C` with white text. `contrast.test.ts` checks every pair in both themes and that the system-dark media block equals the dark block.
- A11y gate: `stories.a11y.test.tsx` runs axe over every story in light and dark (jsdom, so no colour-contrast rule; contrast is the token test plus the Storybook a11y addon in the browser). Add a story for every new component or state.
- Buttons must stay `forwardRef` (Radix `asChild`). Fonts: Inter if present, else system stack; no remote font loading (MV3). Storybook: `pnpm --filter @audion/ui storybook`.
- Extension is WXT 0.21 on Vite 7 (needs Vite >= 6; the extension uses vitest 3 for matching types, other packages stay on vitest 2). Source lives in `apps/extension/src` (`entrypoints/` are thin; real code in `background/`, `pages/`, `lib/`, later `content/`, `inject/`, `panel/`).
- API origin is a build-time setting `VITE_API_URL` (default `http://localhost:8080`); it becomes the only host permission and the only `connect-src`. Pages never call the API directly: they `send()` typed messages (`lib/messages.ts`) to the service worker, which owns the token and install ID (`lib/api.ts`). Binary travels as base64.
- Settings: `settingsSchema` in shared (per-field `.catch` defaults), `createSettingsStore` in `lib/settings.ts` (zustand over `KeyValueStore`; chrome.storage.sync in the extension, localStorage in a plain-browser preview, memory in tests).
- Onboarding is one page `welcome.html` with hash routes (`#/welcome`, `#/permissions`, `#/setup`, `#/done`). Setup combines voice picker and camera calibration (steps 2-3 of 3). Calibration is a real countdown, 2.5 s MediaRecorder clip and `/v1/recognize` call (no segmenter until M5); in mock mode any recognised sign passes, in live mode it must be "hello".
- Camera permission granted to the extension origin does NOT carry over to meet.google.com: Meet's own origin permission is what the content script uses. Onboarding says Chrome may ask again on Meet.
- Dev: run `ALLOWED_ORIGINS='*' MOCK=1 pnpm --filter @audion/api dev` (after `pnpm build` once for shared), then `pnpm --filter @audion/extension build` and load `apps/extension/.output/chrome-mv3` unpacked. The extension ID changes per machine, so use `ALLOWED_ORIGINS='*'` locally only; a stable key for a fixed ID is an M8 task.
- Content script (`entrypoints/content.tsx`, WXT `createShadowRootUi`, `cssInjectionMode: 'ui'`): matches only `https://meet.google.com/*`; `AUDION_FAKE_MEET=1` at build time adds `http://localhost:4173/*` (fake-meet) and makes the panel show on every path there. On real Meet the panel only shows on call URLs (`isMeetCallPath`, polled because Meet navigates without reloads).
- Panel layout: `AudionApp` positions everything from the viewport's right/bottom edges. `useBarClearance` asks `lib/meetDom.locateControlBar` (heuristic: ARIA labels Leave call / mic / camera, climb to the wide bottom strip; null -> fixed 96 px) and the card is clamped so it can never sit below that clearance or off screen (`panel/position.ts`). Dragging also works with arrow keys (Shift = 64 px). Position and expanded/collapsed persist in `chrome.storage.local` (`panelPrefs`); On/Off does not.
- Overlays inside Meet: Drawer is used with `modal={false}` so Radix never sets aria-hidden on Meet's DOM and clicks inside the Shadow DOM are not mistaken for outside clicks (dismiss = Esc or the X). Z-order tokens: layer 2147483000, overlay 2147483001, drawer 2147483002, popover/tooltip 2147483003.
- `lib/meetDom.ts` is still the only Meet-DOM module. Caption area, chat box and mic-state lookups arrive in M6. The control-bar heuristic is only verified against fixtures and fake-meet, NOT yet against live Meet.
- Dev harness: `pnpm --filter @audion/extension harness` builds `tools/fake-meet/audion-harness.js` (gitignored), which mounts the same `AudionApp` in a Shadow root on the fake Meet page without the extension runtime (storage falls back to localStorage). Run fake-meet with `pnpm --filter @audion/fake-meet dev` and open http://localhost:4173/?harness=1 (the flag matters: without it the harness is not loaded, so the real extension and the harness never both mount).
- Supported-signs icons are original SVG hand-shape + body-position glyphs generated from `panel/signs.ts`. The hint sentences are reminders written by the assistant, not reviewed by a signer: have a Deaf/ASL-fluent reviewer check them before release.
- "Report a problem" renders only when `VITE_REPORT_URL` is set at build time (no support destination is decided yet).
- **Hand tracking runs in an extension-origin iframe, not a Web Worker.** A content script cannot start an extension Worker (cross-origin) and Meet's CSP blocks blob workers, so `lib/trackerClient.ts` injects a hidden `tracker.html` iframe (web-accessible, only to the Meet/fake-meet matches). Under site isolation it is its own process, so Meet's main thread stays free. Frames cross as transferred 320x240 `ImageBitmap`s, one in flight at a time (~15 fps); landmarks come back via a small origin- and source-checked `postMessage` protocol (`lib/trackerProtocol.ts`). The page tries the GPU delegate, then CPU.
- MediaPipe assets: `public/models/hand_landmarker.task` is committed (7.8 MB, Apache-2.0, checksum in `MODELS.md`, re-fetch with `scripts/fetch-hand-model.sh`). The SIMD WASM runtime is copied from `@mediapipe/tasks-vision` at build time by a `build:publicAssets` hook in `wxt.config.ts` (the non-SIMD builds are skipped, so Chrome 91+).
- Segmenter (`lib/segmenter.ts`): pure `stepSegmenter(state, frame, cfg)`. Speed = mean displacement of wrist + 5 fingertips in hand-sizes per second (wrist-to-middle-knuckle), so distance from the camera does not matter. Defaults: start 0.9, rest 0.4, hold 400 ms (setting), min 600 ms, max 4 s, pause 1.5 s, dropout tolerance 250 ms. Tests use synthetic landmark fixtures (`src/testing/fixtures.ts`); thresholds still need tuning on real, consented recordings (M8). Never commit video.
- Recorder (`lib/recorder.ts`): MediaRecorder cannot return footage from before it started, so it records from the moment hands appear and restarts every 600 ms until a sign starts. That 600 ms pre-roll plus a 4 s sign plus the 400 ms hold stays within the API's 5 s limit (a longer hold setting can exceed it; the API then answers CLIP_TOO_LARGE).
- Panel state machine (`panel/machine.ts`): the reducer stores flags and `phaseOf()` derives off/starting/ready/seeing/signing/recognising/chips/composing/sentence/speaking, so flags and phase cannot disagree. Problems (lowLight, handsOut, notRecognised, offline, cameraBlocked) overlay any phase; `viewOf()` gives the status icon, label and hint, with a fixed priority. Composing/speaking transitions exist and are tested but are wired up in M6.
- `AudionSession` (`panel/session.ts`) owns camera, tracker, segmenter, recorder and queue, with every dependency injected. `tick(frame?)` is the single step (the loop calls it; tests pass scripted frames). Turning off, or leaving a call URL, stops the camera, tracker and queue and discards waiting clips.
- Recognition queue (`lib/recognitionQueue.ts`): serial, in memory, max 5 clips, retryable failures (network, rate limit) keep the clip and back off 2 s doubling to 15 s while the panel shows Reconnecting. Non-retryable errors drop the clip and show "couldn't recognize that".
- `/healthz` now also returns `confidenceThreshold`; the session reads it when switched on (default 0.5). Below it, a sign becomes a low-confidence chip and a "Did you mean...?" popover asks Yes (Enter) or Try again (Esc). No logprobs (`confidence: null`) means no popover. The panel auto-expands when it needs a confirmation or the camera is blocked.
- Dev harness now needs `pnpm --filter @audion/extension build` first (it serves the tracker page and MediaPipe from `.output/chrome-mv3`). `?fakecam=1` swaps getUserMedia for an animated canvas; `window.__audion` exposes the session and a synthetic-landmark simulator. Note: a hidden browser tab throttles timers to ~1 Hz, so the live loop runs slowly in automation (it is 15 fps in a visible tab); pass frames to `session.tick()` directly, after `clearInterval(session.loop)`.
- **Voice into Meet (M6).** `entrypoints/inject.content.ts` (the `.content.ts` suffix is what makes WXT put it in the manifest as a `world: 'MAIN'`, `document_start` content script) runs `inject/install.ts`, which wraps `navigator.mediaDevices.getUserMedia`. For audio requests Meet gets a track from `lib/audioMixer.ts` (real mic -> micGain, Audion voice -> voiceGain, both -> bus -> destination, plus an analyser for level probes). The real mic always passes through, so a signer who can speak still can; with Audion Off nothing of Audion is added (the Off switch is a pass-through, not an unwrapping: Meet already holds our track). No microphone at all (`NotFoundError`) still yields a voice-carrying track; a permission denial is never overridden. The wrapper mirrors the real mic's label/settings, releases the real mic when Meet stops the track, and watches `track.enabled` so Meet's own mute is known.
- Limits to keep documenting: only streams requested after the inject script runs are wrapped (reload the Meet tab once after install; speaking without a channel shows "Voice not connected"), and Meet's mute silences Audion too (the panel warns "Your Meet microphone is muted"). We deliberately do not bypass Meet's mute.
- Content <-> MAIN world protocol: `lib/voiceProtocol.ts` + `lib/voiceBridge.ts`. Messages are tagged, same-window and same-origin checked, audio bytes are transferred. A page script could forge them; the worst case is Audion playing audio the user could already cause. `Probe` returns channel/mute/peak for e2e checks.
- Compose and speak live in `AudionSession`: after the segmenter's 1.5 s no-hands pause (or the Speak button) the confirmed chips go to `/v1/compose`; it waits while a clip is in flight or a low-confidence sign is unconfirmed. Auto-speak mode speaks at once; confirm-first stops at the sentence (Speak/Cancel). Spoken sentences go to the transcript, and optionally to Meet chat (`postToChat`, setting default OFF, never overwrites a chat draft, opens and closes the chat panel itself). Audion's own voice switch (`panelStore.voiceMuted`) keeps captions and transcript but sends no audio.
- Caption bar (`panel/CaptionBar.tsx`): local only, dark translucent like Meet, above the Audion pill; size, position and signer name from settings; `aria-live=polite`.
- End-of-call summary: opens when the user clicks Meet's Leave call button (`meetDom.watchLeaveCall`) or the URL leaves the call path. Transcript is kept per tab in `chrome.storage.session` via the service worker (`background/handler.ts`): memory-backed so it survives worker suspension, never on disk, cleared on Close or tab close. Copy uses the clipboard API. Feedback sends only `{rating, signs[]}` to `POST /v1/feedback` and only when `feedbackConsent` is on (that endpoint is an addition to the brief's contract; it just logs labels via Pino and stores nothing).
- Real Meet's chat/leave/mute DOM is still unverified: `findChatInput`, `findChatToggle`, `postToChat`, `watchLeaveCall` use ARIA-label heuristics tested only against fixtures and fake-meet.
- Harness: `?fakemic=1` gives a silent fake microphone; the harness installs the inject script itself, so fake-meet's Join button receives the mixed track and its meter shows Audion's voice.
- **Live mode (M7).** `apps/api/src/services/live/`: `GeminiRecognizer` (exact training prompt, clip inline as base64, temperature 0, `maxOutputTokens` 2048, `responseLogprobs`+`logprobs:5`), `GeminiComposer` (system prompt + few-shot turns; the route's grounding guard still checks output), `CloudSpeaker` (Cloud TTS MP3, `audio/mpeg`). Clients are injected so tests use fakes; `services/index.ts` builds `GoogleGenAI({vertexai:true, project, location})` per location (ADC only). A tuned model is just `RECOGNIZE_MODEL=projects/<n>/locations/us-central1/endpoints/<id>` with `RECOGNIZE_LOCATION=us-central1` (from Google's tuning docs; whether tuned models return logprobs is undocumented).
- Confidence (`live/logprobs.ts`): the answer's tokens are found by aligning from the END of the generated tokens (thinking tokens may precede), confidence = probability of the whole answer (product over its tokens), alternatives = first-token top candidates mapped to vocabulary words (exact, or a unique prefix of 3+ letters). Anything that cannot be aligned gives `confidence: null`. If the model rejects logprobs, the recognizer retries once without them and remembers.
- Live mode refuses to start without `GCP_PROJECT`, an explicit `JWT_SECRET` and a non-empty `ALLOWED_ORIGINS` (`checkLiveConfig`), and warns on `ALLOWED_ORIGINS=*`.
- Deployment: `apps/api/Dockerfile` (build from repo root, `pnpm deploy --legacy --prod`, non-root `node` user), `apps/api/cloudbuild.yaml` (build only), `apps/api/DEPLOY.md` (commands for the USER to run; no script in the repo touches IAM, billing or tuning). The Docker image build itself has not been run (no Docker daemon was available); the `pnpm deploy` step and the resulting bundle were verified locally.
- `tools/eval` (`pnpm --filter @audion/eval eval --manifest test.jsonl --clips ./clips --api URL`): accepts Vertex tuning JSONL (clip looked up by file name in `--clips`, nothing fetched from gs://) or `{clip,label}` lines; sends clips only to `--api` (https required except localhost); prints API mode (loud warning for mock), accuracy vs the 26.2% baseline, per-sign accuracy, top confusions, latency, confidence calibration and a threshold sweep for choosing `CONFIDENCE_THRESHOLD`.
- Not verified in M7: any real call to Vertex AI or Cloud TTS (no cloud calls were made from here), the model ID `gemini-3.5-flash` against official docs, logprobs on 3.5 Flash or a tuned endpoint, and the Docker image build.
- **M8 hardening and tests.**
  - Real bugs found only by loading the built extension in a real browser: (1) `process.env.AUDION_*` was left raw in the content-script bundle and would have thrown at load in every real Chrome (fixed with `define` in `wxt.config.ts`); (2) the API behind Cloud Run saw one IP for all users (fixed: `TRUST_PROXY_HOPS`, function form `(addr, hop) => hop < n`; a numeric trustProxy did not behave); (3) the tracker bundle carried the fake-Meet origin in release builds; (4) the harness script mounted a second Audion next to the real extension (now only with `?harness=1`).
  - `scripts/check-build-lib.mjs` (+ `check-build` script, run by `pnpm check` and CI) fails a release build that has any permission beyond `storage`, a host permission other than the API origin, a weakened CSP, extra web-accessible resources, a pinned `key`, a raw `process.env`, remote code loading, the e2e hook, or the fake-Meet host. `scripts/check-pins.mjs` fails any unpinned dependency.
  - API: model and TTS calls have deadlines and abort signals (`services/live/timeout.ts`: 30/20/15 s); `TRUST_PROXY_HOPS` (Cloud Run = 1); live mode config checks.
  - Extension: the inject script falls back to the plain stream if our audio setup throws (never breaks Meet's call); `ErrorBoundary` removes a crashed panel quietly.
  - E2E (`e2e/`, Playwright, real Chromium with the real unpacked extension, fake camera, silent fake microphone file, mock API, fake Meet): `tests/flow` (call flow incl. audio level on the outgoing track, keyboard-only use, onboarding, network audit), `tests/visual` (screens 1-11, macOS baselines committed), `tests/store` (store screenshots and tiles). The build needs `AUDION_FAKE_MEET=1 AUDION_E2E=1`; the e2e hook (`panel/e2eHook.ts`: `audion:e2e-frame|dispatch|speak` events, `data-audion-state`) exists only in such builds, and `check-build` rejects it in a release.
  - E2E limits: the fake camera shows no hands, so tests feed synthetic landmarks; in that Chromium extension pages already report camera/microphone as granted, so the Needed -> Allowed transition is only unit-tested.
  - Thresholds: `eval` prints a suggested `CONFIDENCE_THRESHOLD` (lowest value whose unasked signs are >= 90% right while asking about <= 40%); `eval segment` replays recorded landmark files against the segmenter thresholds (`pnpm --filter @audion/eval segment`); the harness has a "Record landmarks" button (hand points only, no video). Real tuning still needs real data.
  - Store: `store/listing.md`, `store/PRIVACY.md` (DRAFT, needs legal review and the bracketed items), screenshots (simulated Meet page) and promo tiles. `docs/extension-id.md` explains a stable dev ID via `EXTENSION_KEY`.

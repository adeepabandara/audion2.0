# Ola by Audion: the project in detail

_Written 2026-10-16 from the code, the decision log in `NOTES.md` and the measurements taken while building. Where something was not tested, this guide says so. Nothing here is committed or publicly deployed yet._

---

## 1. In plain words

**Ola lets a Deaf or hard-of-hearing person who signs American Sign Language (ASL) be heard in a video call.**
They sign to their webcam. Ola recognises each sign on their own device, joins the signs into a natural English sentence, shows it as a caption and says it aloud in a voice they chose.

There are two products built from one codebase:

| Product              | What it is                                                                                                                                                          | Who it is for                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Chrome extension** | A small panel inside Google Meet. Ola's voice goes into the call through the signer's microphone, so the other people hear it (and Meet's own captions caption it). | The signer, in real calls.                                           |
| **Public web demo**  | One web page that looks like a video call. Ola's panel floats inside it. Hosted on Google Cloud Run. It is the link for the **AI Builder Cup** submission.          | Judges and visitors who want to try Ola without installing anything. |

Both use the same panel code, so a change to the panel changes both.

---

## 2. The idea behind the design

1. **Fast.** Naming a sign must not wait on the cloud. A small neural network on the visitor's device names each sign in milliseconds.
2. **Private.** Video never leaves the device for the default flow, and it is never stored anywhere. Only text (a sentence) ever goes to the cloud.
3. **Google models where they matter.** MediaPipe finds the hands, Gemma 4 and Gemini write the sentence, Google Cloud Text-to-Speech speaks it. (The AI Builder Cup requires Gemini or Gemma models and a Cloud Run or Firebase deployment.)
4. **Honest.** If the recogniser is not confident, Ola asks the signer to sign again instead of guessing. Every state shows an icon **and** words, never colour alone.

---

## 3. How a sign becomes speech

```
Camera
  │
  ▼
1. MediaPipe Hand Landmarker (on the device)   21 points per hand, every frame
  │
  ▼
2. Sign cutter (on the device, plain rules)    hands move = a sign; they rest = it ended
  │
  ▼
3. Sign classifier (on the device)             names the sign in a few milliseconds
  │      confident (>= 50%)  →  the sign appears as a chip at once
  │      not sure            →  "sign again" (nothing is sent anywhere)
  ▼
4. Sentence (after a pause with no new sign)
  │      one sign   →  a fixed phrase ("Hello.")                    no model
  │      2+ signs   →  Gemma 4 E2B in the browser (web demo)
  │                    or Gemini on Google Cloud (fallback / extension)
  │      optional   →  translated into another language (Gemini)
  ▼
5. Voice: Google Cloud Text-to-Speech          one of 24 voices, pitch and speed adjustable
  │
  ▼
6. Output: speakers (web demo)  /  speakers + the Meet call (extension)  +  caption bar
```

### 3.1 Step by step

| Step          | What happens                                                                                                                       | Where it runs                                      | Model                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| Hand tracking | The camera frame (320×240, about 15 per second) goes to a hidden page, which returns the positions of 21 points on each hand.      | The visitor's browser (hidden `tracker.html` page) | **MediaPipe Hand Landmarker** (Google)           |
| Sign cutting  | A rule measures hand speed. Fast = signing. About 0.4 s of rest = the sign ended. Clips under 0.6 s or over 4 s are dropped.       | Browser                                            | none (plain code)                                |
| Sign naming   | 32 frames × 132 numbers per frame go through a small recurrent network and give a sign plus a confidence.                          | Browser (hand-written JavaScript, no library)      | **Our own trained classifier** (GRU)             |
| Sentence      | After a pause (default 3 s), the signs are joined. A check rejects any word not derivable from the signs (or the meeting summary). | Browser (Gemma) or server (Gemini)                 | **Gemma 4 E2B** / **Gemini 3.5 Flash**           |
| Voice         | The sentence goes to the API, which asks Cloud Text-to-Speech for MP3 audio. Twenty-two single-sign phrases are cached.            | Cloud Run                                          | **Google Cloud Text-to-Speech** (Neural2 voices) |
| Playing       | The audio plays on the device speakers. In Meet it is also mixed into the outgoing microphone track.                               | Browser                                            | none                                             |

### 3.2 The on-device classifier

- **What it is:** a 1-layer GRU (256 units) plus a linear layer, trained in PyTorch, exported as a 6.6 MB JSON file (`apps/extension/public/models/signclf.json`) and run by hand-written JavaScript (`apps/extension/src/lib/classifier.ts`). It adds no library.
- **What it sees (since 2026-10-18):** for each of 48 frames, 132 numbers about the hands (shape and movement) plus 12 about **where the hands are on the body** (wrist and index fingertip from the nose, wrist from the shoulders). The body points come from **MediaPipe Pose Landmarker lite**, which the tracker page now runs next to the hand tracker (about 12 ms more per frame, measured on one GPU). If the pose model cannot load, hands are still tracked and the body numbers are zeros.
- **What it knows:** 40 classes: the 22 isolated signs plus 18 two-sign phrases.
  The 22 signs: hello, bye, yes, no, please, thankyou, wait, why, who, where, now, later, tomorrow, time, finish, think, look, listen, talk, fine, same, not.
- **Training data:** **PopSign ASL v1.0** (CC BY 4.0, Georgia Tech and the Deaf Professional Arts Network), up to 450 train, 100 val and 100 test clips per sign, split so that no signer is in two splits (31 / 8 / 8 signers). Turned into hand and body points by `tools/signclf/extract_pose.py`; only the points are kept, outside the repository (`Test/audion-data/landmarks_v2/`).
- **Phrases are synthetic.** The phrase classes are built by joining two isolated-sign clips (`tools/signclf/synthesize_phrases.py`), not from real two-sign videos; their scores should not be read as real-world accuracy.
- **Measured accuracy on clips from signers it never saw (3,959 test clips, `tools/signclf/compare.py`):**

| Measure                                     | Previous model (hands only) | Current model (hands + body) |
| ------------------------------------------- | --------------------------- | ---------------------------- |
| Real single signs, all answers              | 82.4%                       | **90.4%**                    |
| Real single signs at confidence ≥ 0.5 (app) | answers 88%, 88.3% right    | answers 93%, **94.0%** right |
| All clips incl. synthetic phrases           | 86.8%                       | **92.9%**                    |

- **Weak signs (test):** think 65%, why 68%, talk 74%, listen and tomorrow 80%. Common mix-ups: talk → fine, think → why, tomorrow → not, listen → hello.
- **Not measured:** accuracy on a real webcam. The training videos are phone-style clips, so a real webcam may score lower.
- **Parity:** a golden file of synthetic inputs (with synthetic body points) checks that the JavaScript gives the same answers as PyTorch; a one-off check on 400 real test clips gave identical answers.

### 3.3 Gemma 4 on the device (web demo)

- Model: `gemma-4-E2B-it-web.litertlm` (2,008,432,640 bytes, Apache-2.0) from Hugging Face, loaded with `@litert-lm/core` 0.18.0 in the visitor's browser on **WebGPU**.
- It starts loading the first time Ola is turned on, downloads once into the browser's cache storage, and is used for sentences with two or more signs. Until it is ready (or if it cannot run), Gemini writes the sentence, so nothing waits on it.
- Measured with the file served locally: 270–540 ms per sentence (Gemini takes about 1.9 s). Sentences were correct but terse ("Thank you, fine, bye.").
- **Not measured:** the real 2 GB download over the internet; browsers or GPUs other than the test one.
- **Not in the extension** (web demo only).

### 3.4 Gemini (Google Cloud, Vertex AI)

| Use                           | Model                                                             | When                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Sentence from several signs   | Gemini 3.5 Flash (base), global endpoint                          | When Gemma is not ready, and in the extension                                                                                  |
| Translation of Ola's sentence | Gemini (the compose model)                                        | When the signer picks a language                                                                                               |
| Meeting summary               | Gemini (the compose model)                                        | Only if the signer turns **Meeting context** on                                                                                |
| Sign recognition (tuned)      | Your **tuned Gemini 3.5 Flash** endpoint in the `us` multi-region | **Off by default.** Used only if "Have Gemini double-check signs" is on, or if the on-device classifier gives no answer at all |

Measured facts about the tuned endpoint (October 2026): about 2.8 s inside Google even for a one-word answer, 3 s or more per sign in practice, and spikes of 14–118 s with some 429 errors when capacity was tight. That is why recognition moved on-device. **The tuned model's accuracy has never been measured** (the one hello test clip was never answered "hello" by any checkpoint).

### 3.5 Google Cloud Text-to-Speech and Speech-to-Text

- 24 Neural2 voices in four accents (American, British, Indian, Australian). The first four (Aria, Nora, David, Miles) have fixed ids.
- Pitch is adjustable (−8 to +8 semitones) and speed 0.75–1.5×.
- With a non-English language, Google picks a voice for that language from the language code and the chosen voice's gender.
- **Voice check:** Speech-to-Text transcribes the chosen voice's sample so the signer can see what others will hear.

---

## 4. The two products

### 4.1 Chrome extension (Manifest V3)

- **Content script** (isolated world) draws the panel in a Shadow DOM, owns the camera, hand tracking, sign cutter, clip recorder and the caption bar.
- **MAIN-world script** (document start) wraps `getUserMedia` so the outgoing microphone track is a Web Audio mixer: real microphone + Ola's voice. With Ola off it is a pass-through.
- **Service worker** keeps the session token, settings, the API client, the offline queue and the in-memory transcript.
- **Voice delivery check:** after each sentence the page script reads the call's own audio statistics (`RTCRtpSender.getStats()`) to tell whether Ola's voice really entered the call. The panel then says "reached the call" or warns that it did not.
- **Meeting context (opt-in):** reads Meet's live captions, keeps a short Gemini summary, and uses it to word sentences ("What time is the demo?").
- **Permissions:** only `storage`, `https://meet.google.com/*` and the API origin. A build check fails the release if anything else slips in.
- **Verified:** loads and runs on a real Meet page, the API answers real calls, the panel and tracker work. **Not verified:** that the other side hears Ola on a real Meet call after the latest changes; the Chrome extension on a fresh profile; Meet's real caption markup.

### 4.2 Public web demo

- **One Cloud Run service** serves the page, the hand tracker, the MediaPipe files, the classifier weights and the API on one address.
- **The page** is a simulated call window (browser bar, four tiles with **You** first, a control bar) with Ola's pill at the bottom right. It starts collapsed on every visit.
- **The other three people** are short looped videos supplied by the owner (re-encoded to about 1 MB each). **Open:** confirm you have the right to show them publicly.
- **Behind the scenes** (button under the window): a live architecture diagram of the real pipeline with moving data dots, the model logos (Google Cloud, Gemini, Gemma, Google AI Edge, Google Meet), step descriptions with live numbers, and a "Play a sample" run. It says plainly when the copy is in test mode.
- **Not a Google Meet imitation:** no Meet logo, colours or name, and a made-up address, so it cannot be mistaken for Google's product.
- **First deploy** (service `ola-demo`, project `audion-511503`, `us-central1`, min 1 / max 3 instances): the private revision answered health, page, tracker, classifier weights, compose, translation and a Spanish voice. **Not done:** public access (your IAM step), custom domain, and a real-browser test against the deployed URL.

---

## 5. The panel, state by state

The card is a fixed 540 px high, nothing in it scrolls, and all messages are drawn on the camera picture one at a time. **See the gallery in [`ui-components/`](../ui-components/index.html) for a picture of every state.**

| State            | Meaning                                           | Status label  |
| ---------------- | ------------------------------------------------- | ------------- |
| Off              | Ola is switched off; the camera is not used       | Off (red dot) |
| Starting         | Asking for the camera and loading hand tracking   | Starting      |
| Ready            | Camera works; waiting for hands                   | Ready         |
| Seeing you       | Hands in view                                     | Seeing you    |
| Signing          | Hands moving like a sign                          | Signing       |
| Recognising      | The sign ended; being named                       | Recognising   |
| Signs recognised | Chips in the row                                  | Ready         |
| Writing          | Joining the signs into a sentence                 | Writing       |
| Sentence ready   | Waits (Confirm first) or is spoken at once (Auto) | Ready         |
| Speaking         | Voice is playing                                  | Speaking      |

Problems that overlay any state, in priority order: **camera blocked**, **offline / reconnecting**, **voice not connected** (Meet only), **couldn't recognise that**, **poor lighting**, **hands out of frame**.

The collapsed **pill** shows the logo, a status capsule (a red dot while off), the On/Off switch and an expand button. It opens by itself if something needs the signer's attention.

---

## 6. Settings

All stored in `chrome.storage.sync` in the extension (browser memory in the web demo). Nothing here is video or a transcript. Defined in `packages/shared/src/settings.ts`.

| Tab     | Setting                                                        | Default                               | What it does                                                                                                   |
| ------- | -------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Voice   | Translate to (`language`)                                      | English (off)                         | Translates Ola's sentence into 8 languages; the translated text is shown and spoken                            |
| Voice   | My voice (`voiceId`, `pitch`, `speed`, `voiceSetupDone`)       | Aria, 0, 1×                           | A guided set-up: five questions, up to three recommended voices, "hear it", "see it", "what will people hear?" |
| Voice   | When Ola speaks (`speakMode`)                                  | Auto-speak                            | Auto, or **Confirm first** (Speak / Cancel buttons appear)                                                     |
| Voice   | Hear Ola on this device (`monitorVoice`)                       | On                                    | Also plays the voice on the signer's speakers                                                                  |
| Signing | Sentence pause (`pauseMs`)                                     | 3 s (Short 1.5 / Normal 3 / Long 4.5) | How long Ola waits after the last sign before joining signs                                                    |
| Signing | Fast signs on this device (`fastSigns`)                        | On                                    | Use the on-device classifier                                                                                   |
| Signing | Have Gemini double-check signs (`cloudCheck`)                  | **Off**                               | Also sends each clip to the tuned Gemini and corrects the answer                                               |
| Signing | Meeting context (`meetingContext`)                             | **Off**                               | Opt-in: Meet captions summarised by Gemini                                                                     |
| Signs   | —                                                              | —                                     | The supported signs, each with a hand-shape picture and hint                                                   |
| Display | Caption size / position, chat post (`postToChat`), theme, name | Medium / bottom, off, system          |                                                                                                                |
| About   | Privacy promise, PopSign credit, recognition model             |                                       |                                                                                                                |

Other stored values: `holdTimeMs` (200–1500, default 400), `feedbackConsent`, `onboardingDone`.

---

## 7. First-run screens (extension)

Welcome (what Ola is and where it works) → Camera permission (why, and the privacy promise) → Set-up (voice set-up and a sign check, which can be skipped) → Done. Shown once, in a browser tab, after installing.

---

## 8. The UI component library (`packages/ui`)

Plain CSS with `--au-*` design tokens (light, dark, system), no Tailwind; one stylesheet drops into a Shadow DOM. Brand: primary teal `#0F766E` (never as text on dark), highlight `#2DD4BF`.

| Component                      | File                          | Used for                                                  |
| ------------------------------ | ----------------------------- | --------------------------------------------------------- |
| Button                         | `components/Button.tsx`       | Primary / secondary / ghost / danger, icon-only           |
| Toggle                         | `components/Toggle.tsx`       | The switch with ON / OFF written inside                   |
| Segmented                      | `components/Segmented.tsx`    | Choose one of a few (speak mode, pause)                   |
| Slider                         | `components/Slider.tsx`       | Speed and pitch                                           |
| StatusPill                     | `components/StatusPill.tsx`   | The nine statuses, icon + words                           |
| Chip                           | `components/Chip.tsx`         | A recognised sign                                         |
| Banner                         | `components/Banner.tsx`       | Info / warning / error messages                           |
| Card, Drawer, Popover, Tooltip | `components/…`                | Containers and overlays (portaled through `ThemedPortal`) |
| Tabs                           | `components/Tabs.tsx`         | Settings tabs (arrow keys)                                |
| VoiceCard                      | `components/VoiceCard.tsx`    | A voice with a play button                                |
| LanguageMenu, Flag             | `components/…`                | Language picker with drawn flags                          |
| KeyHint                        | `components/KeyHint.tsx`      | Keyboard hints                                            |
| BrainSparkle                   | `components/BrainSparkle.tsx` | Meeting-context icon (Fluent UI System Icons, MIT)        |
| Wordmark                       | `components/Wordmark.tsx`     | The Ola logo                                              |
| Icons                          | `icons.tsx`                   | 26 line icons                                             |

The panel built from them lives in `apps/extension/src/panel/` (`PanelCard`, `Pill`, `CaptionBar`, `SettingsDrawer`, `SignsGrid`, `SummaryCard`, the state machine `machine.ts` and the orchestrator `session.ts`).

---

## 9. The API (Fastify on Cloud Run)

| Route                  | Purpose                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/session`     | Anonymous 15-minute token for an install id (random UUID)                                                                                   |
| `POST /v1/recognize`   | One sign clip → `{ sign, confidence, … }` (tuned/base Gemini; now only for the optional check or fallback)                                  |
| `POST /v1/compose`     | Signs (+ optional meeting summary) → one sentence. One sign uses a fixed rule; several use Gemini; a grounding guard rejects invented words |
| `POST /v1/context`     | Live-caption text → short meeting summary (Gemini)                                                                                          |
| `POST /v1/translate`   | Sentence → another language (Gemini)                                                                                                        |
| `POST /v1/speak`       | Sentence → MP3 (Cloud Text-to-Speech)                                                                                                       |
| `POST /v1/voice-check` | Speaks a line, transcribes it (Speech-to-Text), returns what was heard                                                                      |
| `POST /v1/feedback`    | Thumbs up/down plus sign labels, only with consent; stores nothing                                                                          |
| `GET /v1/health`       | `{ ok, mode, modelId, … }` (Cloud Run answers `/healthz` itself with 404, so the app uses `/v1/health`)                                     |

Protections: zod validation on every input, size limits, per-install and per-IP rate limits, a daily cost cap (`DAILY_CALL_CAP`, in memory per instance), Pino logging that never records bodies, clips or captions, CORS allow-list (the web demo's own origin is accepted only when it serves the page), security headers. A test fails if any code in `apps/api/src` writes to disk.

**Mock mode (`MOCK=1`)** runs the whole thing with no Google Cloud (fake recogniser, rule-based composer, placeholder tone). `SPEAKER_MODE=cloud` lets mock mode use the real voices.

Main environment settings (all config, never code; no endpoint ids in git): `MOCK`, `GCP_PROJECT_ID`, `RECOGNIZER_MODE` (`tuned|base|mock`), `TUNED_ENDPOINT_ID`, `TUNED_LOCATION`, `COMPOSE_MODEL`, `COMPOSE_LOCATION`, `WEB_DIR`, `ALLOWED_ORIGINS`, `JWT_SECRET` (from Secret Manager), `DAILY_CALL_CAP`, `WARM_UP`, `TRUST_PROXY_HOPS`.

---

## 10. Privacy, safety and accessibility

- **Your video is processed to recognise signs and never stored.** Frames and clips live in memory only. In the default flow the clip never leaves the device at all.
- **What does leave the device:** the sentence text (for translation, speaking and voice checks); signs as words (for Gemini sentences); the meeting's caption text **only** if Meeting context is turned on (held in memory, never stored or logged, forgotten when Ola turns off).
- **Prompt injection:** meeting captions are treated as untrusted data; the summary is length-capped and the grounding guard limits what can reach a sentence.
- **No secrets in the repo.** The API uses Application Default Credentials on Cloud Run. No service-account keys.
- **Never from code:** starting tuning jobs, changing IAM, billing or project settings. You do those.
- **Accessibility:** WCAG AA contrast (a test checks every colour pair in both themes), full keyboard use, visible focus, `aria-live` for status and captions, icon plus words for every state, `prefers-reduced-motion` respected.
- **Open point (accessibility):** the call videos in the web demo loop for longer than 5 seconds and no longer have an on-page pause button (removed on request). They start paused for visitors who ask for reduced motion. WCAG 2.2.2 normally asks for a pause control.

---

## 11. Repository map

```
apps/extension     Chrome extension (WXT, React): src/{panel,pages,lib,inject,tracker,web,gallery,background,content}
apps/api           Fastify API for Cloud Run: src/{app,config,services}, scripts/, Dockerfile, DEPLOY.md
packages/shared    zod schemas, signs, voices, settings, grounding guard, constants
packages/ui        design tokens and components (Storybook stories included)
tools/eval         offline evaluation of /v1/recognize on labelled clips
tools/fake-meet    a local page that imitates a Meet call (dev and tests)
tools/signclf      Python scripts for the classifier: make_manifest, extract, train, features, golden, synthesize_phrases
e2e                Playwright end-to-end tests (real Chromium with the real extension)
ui-components      the UI gallery (index.html) and 92 screenshots
docs               this guide and extension-id.md
NOTES.md          the working rules and the dated decision log (the source of truth for why things are as they are)
```

Outside the repository (on purpose): `Test/audion-data/` holds the extracted hand points, the Python environment and the trained model output (derived from PopSign data, CC BY).

### Commands

| Command                                                     | What it does                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm build` · `typecheck` · `lint` · `test` · `check`      | The normal quality gates (`check` runs all)                              |
| `pnpm --filter @audion/demo build`                          | Builds the public web demo into `apps/demo/dist/`                        |
| `pnpm --filter @audion/extension build:gallery`             | Rebuilds `ui-components/index.html`                                      |
| `node apps/extension/scripts/gallery-shots.mjs`             | Retakes the gallery screenshots                                          |
| `pnpm --filter @audion/api smoke <url>`                     | Checks a deployed site (page, tracker, health, session, sentence, voice) |
| `pnpm --filter @audion/api probe / eval / latency / voices` | One-off tools for the tuned model, accuracy, latency and voices          |
| `python tools/signclf/train.py …`                           | Retrains the classifier (needs the extracted hand points)                |

---

## 12. Testing: what was and was not checked

| Area                     | Checked                                                                                                                                          | Not checked                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Unit and component tests | Extension 309 passing, API 120 passing                                                                                                           | —                                                                                                              |
| Classifier               | Held-out test clips (86.7%), JavaScript-vs-PyTorch parity                                                                                        | A real webcam; real two-sign phrases                                                                           |
| Web demo                 | Mock-mode page, panel, assets, same-origin API; private Cloud Run revision (health, page, tracker, weights, compose, translate, a Spanish voice) | Camera and signing in a real browser against the deployed site; phone-width layout; public access              |
| Gemma                    | Loaded and wrote four sentences from a locally served file                                                                                       | A real 2 GB download; other browsers or GPUs                                                                   |
| Extension                | Loads on real Meet; API calls succeed; voice reaches local speakers                                                                              | The other side hearing Ola on a real call with the latest build; Meet's caption markup; a fresh Chrome profile |
| Tuned Gemini             | Endpoint, host and auth confirmed; WebM accepted                                                                                                 | **Accuracy** (never measured)                                                                                  |
| Docker image             | Built by Cloud Build for the first deploy                                                                                                        | Built locally (Docker Desktop was not running)                                                                 |
| e2e and visual baselines | —                                                                                                                                                | Not rerun since the panel changed; baselines are out of date                                                   |

---

## 13. The AI Builder Cup

The rule (as given): _"All prototype submissions must integrate AI models such as the family of Gemini or Gemma models or built using agentic platforms … and prototypes must be deployed on Google Cloud Platform using Cloud Run or Firebase. A valid and accessible link to a deployed, working prototype must remain functional throughout the evaluation."_

| Requirement                   | How Ola meets it                                                                                                     | Risk                                                                                                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini / Gemma                | Gemma 4 and Gemini write sentences; Gemini translates and summarises; the optional check uses the tuned Gemini       | The **sign** step is now our own classifier, not Gemini or Gemma. Gemma is a 2 GB opt-in-by-download. A judge who sees only the classifier might not count it. Consider turning the Gemini double-check back on, and ask the organisers |
| Google Cloud                  | Cloud Run (page + API), Vertex AI, Text-to-Speech, Speech-to-Text                                                    | —                                                                                                                                                                                                                                       |
| Link works through evaluation | One always-on instance (min 1), capped instances, a daily call cap; recognition no longer depends on Vertex capacity | Public access and budget alerts are still your steps; do not redeploy or delete the tuned endpoint while judging                                                                                                                        |
| MediaPipe                     | A Google AI model, but not Gemini or Gemma. "Such as" suggests the list is not closed                                | Unconfirmed with the organisers                                                                                                                                                                                                         |

---

## 14. Known issues and open decisions

1. **"No ca…"** — the card header's status for a blocked camera is cut off in the 336 px card.
2. **Public access** — the service is private until you grant public invocation (your IAM decision). The domain mapping (`ola.audion.live`) and its verification are not done.
3. **Looped call videos** — confirm you may show those people publicly.
4. **No pause control** on the looping call videos (see section 10).
5. **Classifier weights** are derived from CC BY PopSign data. Decide whether to commit them; credit PopSign (the diagram's side panel does).
6. **Sample signs for judges who cannot sign.** The earlier plan (replay sample signs as keypoints) was never built. The web demo can run on a video file (code kept, page control removed). Decide how judges without sign knowledge see a result.
7. **Cup rule reading** — confirm that an on-device classifier plus Gemma/Gemini for sentences satisfies it.
8. **Real-world accuracy** of the classifier and of the tuned Gemini is unmeasured.
9. **Other signs and phrases** — phrases are synthetic; the list is Ola's whole vocabulary.
10. **Voice set-up wording** should be reviewed by a Deaf or hard-of-hearing person, and the sign hints by an ASL-fluent reviewer.
11. **Pre-existing formatting warnings** in `apps/api/src/services/live/logprobs.ts` and `apps/extension/src/lib/classifier.golden.json` make `pnpm lint` fail on `prettier --check`.
12. **Nothing is committed.** Work is in the working folder only.

---

## 15. Where to look next

- **Why is it like this?** `NOTES.md` decision log (dated entries, with what was measured).
- **How do I deploy?** `apps/api/DEPLOY.md` (commands for you to run; nothing in the repo touches IAM or billing).
- **What does each screen look like?** `ui-components/index.html` and `ui-components/screenshots/`.
- **How do I retrain the classifier?** `tools/signclf/` (`make_manifest.py` → `extract.py` → `train.py`).

# Audion

**Sign. Be heard in any Google Meet call.**

Audion is a Chrome extension (Manifest V3) for people who sign American Sign Language. You sign to your webcam in a
Google Meet call. Audion recognises the signs, joins them into an English sentence, shows it to you as a caption, and
speaks it into the call in a voice you choose.

> **Your video is processed to recognize signs and is never stored.** Hand tracking runs on your device. Only a short
> clip of one sign is sent to be recognised; it is kept in memory for the request and discarded.

## Status

All eight milestones are built. What is **not** done, because it needs things only the project owner has:

- **Accuracy against the 26.2% baseline is unmeasured.** It needs your tuned model, your labelled clips and a deployed
  API. The tooling is ready (`pnpm --filter @audion/eval eval`).
- **Nothing has been run against real Google Cloud** (Vertex AI, Text-to-Speech) or on **real Google Meet**. Everything is
  tested against fakes, a mock API and a simulated Meet page.
- The Docker image build and the Chrome Web Store submission have not been run.

See [NOTES.md](NOTES.md) for the full list of what was and was not verified, and for architecture and decisions.

## How it works

```
Meet tab
  panel (Shadow DOM)  camera -> hand tracking (MediaPipe, in an extension iframe) -> sign segmentation
                      -> short clip -> service worker ------------------------------+
  caption bar, summary                                                              | HTTPS
  voice: a script in the page's own world wraps getUserMedia so Meet's outgoing     v
         microphone track = your real mic + Audion's voice (Web Audio mixer)   Audion API (Cloud Run)
                                                                                 recognise / compose / speak
                                                                                 -> Vertex AI Gemini, Cloud TTS
```

Recognition is one isolated sign per clip. Sentences come from a separate step that only adds the minimum grammar
words (and is checked so it cannot add content words that were not signed).

## Try it locally (no Google Cloud needed)

Needs Node 22.13+ and pnpm.

```bash
pnpm install
pnpm build
ALLOWED_ORIGINS='*' MOCK=1 pnpm --filter @audion/api dev          # mock API on :8080
pnpm --filter @audion/extension build                             # then in Chrome:
# chrome://extensions > Developer mode > Load unpacked > apps/extension/.output/chrome-mv3
```

The welcome page opens on install. In mock mode the "recognised" signs are scripted, so this is for trying the
interface, not the accuracy.

Without a call: `pnpm --filter @audion/extension harness`, `pnpm --filter @audion/fake-meet dev`, then open
`http://localhost:4173/?harness=1&fakecam=1&fakemic=1`.

## Using it

1. On install, complete the short setup: allow camera and microphone, pick a voice and speed, check your camera.
2. In a Meet call, turn Audion **On** from the pill at the bottom right (reload the Meet tab once after installing).
3. Sign slowly and clearly, one sign at a time, with your hands inside the outline. Lower your hands for a moment to
   finish a sentence, or press **Speak**.
4. If Audion is unsure it asks "Did you mean…?" (Enter = yes, Esc = try again).
5. When the call ends, a summary lists what Audion said for you.

Supported signs (22): hello, bye, yes, no, please, thank you, wait, why, who, where, now, later, tomorrow, time, finish,
think, look, listen, talk, fine, same, not. The list will grow.

## Limits you should know about

- Other people **cannot see Audion's caption bar**. They hear your voice, so Meet's own live captions can caption it. The
  optional "Also post sentences to Meet chat" setting (off by default) lets them read it.
- **Meet's mute switch also mutes Audion's voice.** Audion warns you when Meet is muted.
- Audion's voice can join the call only if the Meet tab was loaded after Audion was installed (reload once).
- The recognition model is early and will make mistakes. The sign hints in the app were written by the developers,
  not a signer; have an ASL-fluent reviewer check them before release.

## Accessibility

Every control works by keyboard with visible focus; status and captions are announced politely; every state has an icon
and text, never colour alone; text meets WCAG AA contrast in light and dark themes (checked in tests); animation honours
`prefers-reduced-motion`.

## Privacy, in detail

See [store/PRIVACY.md](store/PRIVACY.md) (a draft that still needs legal review). Short version: clips are never
written to disk, logs hold only request IDs, timings, sign words and error codes, the extension asks only for the
`storage` permission plus access to Meet and your Audion service, and it loads no remote code.

## Developing

```bash
pnpm check                                   # pins, build, release-build check, typecheck, lint, unit tests
pnpm --filter @audion/ui storybook           # component library (axe checks run in the unit tests)
pnpm --filter @audion/e2e build-extension    # extension build with the fake-Meet match and test hook
pnpm --filter @audion/e2e e2e               # end-to-end tests: real Chromium, real extension, mock API
pnpm --filter @audion/e2e e2e:visual        # screenshots of screens 1-11 (baselines are macOS)
pnpm --filter @audion/e2e store-assets       # store screenshots and promo tiles into store/
pnpm --filter @audion/eval eval --help       # accuracy report against an API (needs your clips)
pnpm --filter @audion/eval segment --help    # tune sign segmentation on recorded hand landmarks
```

Install Chromium for the end-to-end tests once with `pnpm --filter @audion/e2e exec playwright install chromium`.
`pnpm check` leaves a release build in `apps/extension/.output`; run `build-extension` again before the e2e tests.

| Path              | What                                                         |
| ----------------- | ------------------------------------------------------------ |
| `apps/extension`  | The Chrome extension (WXT, React, MediaPipe)                 |
| `apps/api`        | Fastify API for Cloud Run (mock and live modes); `DEPLOY.md` |
| `packages/shared` | Schemas, the 22 signs, voices, constants                     |
| `packages/ui`     | Design tokens and components (Storybook)                     |
| `tools/eval`      | Accuracy report, threshold suggestion, segmentation replay   |
| `tools/fake-meet` | A local page that imitates a Meet call                       |
| `e2e`             | Playwright tests, visual baselines, store asset generator    |
| `store`           | Chrome Web Store listing text, privacy policy draft, images  |
| `docs`            | Notes such as how to pin a development extension ID          |

## Deploying

[apps/api/DEPLOY.md](apps/api/DEPLOY.md) has the commands for you to run. Nothing in this repository creates cloud
resources, changes IAM or billing, or starts tuning jobs.

## Credits

- Sign recognition model tuned on **PopSign ASL v1.0** (CC BY 4.0), Georgia Tech and the Deaf Professional Arts Network.
- Hand tracking: Google **MediaPipe** Hand Landmarker (Apache-2.0), bundled in the extension.
- Sentences: Google **Gemma 4** (on device in the web demo) and **Gemini** (Google Cloud); voices: Google Cloud Text-to-Speech.
- Built with React, Radix UI, Fastify, Zustand, WXT and Vite (all MIT or similar).

License: not chosen yet.

## Third-party notices

- **Fluent UI System Icons** (Microsoft), the `brain-sparkle-16-regular` icon, used for the meeting-context badge
  (`packages/ui/src/components/BrainSparkle.tsx`). MIT licence, Copyright (c) 2020 Microsoft Corporation. Source:
  https://github.com/microsoft/fluentui-system-icons

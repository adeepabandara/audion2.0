# Ola UI components

Every part of Ola's interface, drawn by the real code, in every state, with a note on when it appears.

## What is in this folder

| What | Where |
| --- | --- |
| **The gallery** (one file, double-click to open, works offline, light/dark switch) | `index.html` |
| **Pictures of every state** (PNG, dark and light) | `screenshots/dark/…`, `screenshots/light/…` |

The gallery is built from the extension's own components (`apps/extension/src/panel`, `apps/extension/src/pages/onboarding`, `packages/ui`), so it cannot drift from the product the way a mock-up can.

## The sections, in the order a signer meets them

| # | Section | Folder in `screenshots/<theme>/` | What it shows |
| --- | --- | --- | --- |
| 1 | **The main flow** | `flow/` | Off → Starting camera → Ready → Seeing you → Signing → Recognising → Signs recognised → Writing your sentence → Sentence ready → Speaking, plus "Confirm first" (Speak / Cancel) and "Voice off" |
| 2 | **When something goes wrong** | `problems/` | Camera blocked, Poor lighting, Hands out of frame, Couldn't recognise that, Reconnecting, Voice not connected (Meet only), Notice |
| 3 | **Meeting context** | `context/` | The brain badge: off, waiting for captions, following the meeting |
| 4 | **The collapsed pill** | `pill/` | The small bar shown when the card is folded away, in eight statuses |
| 5 | **Captions** | `captions/` | The caption bar in three sizes, docked at the bottom or top |
| 6 | **Settings** | `settings/` | The drawer, one picture per tab: Voice, Signing, Signs, Display, About |
| 7 | **The signs list** | `signs/` | The supported signs with a hand-shape picture and a hint |
| 8 | **Call summary** | `summary/` | What Ola said, shown when a call ends |
| 9 | **First-run screens** | `onboarding/` | Welcome, camera permission, set-up (voice and sign check), done |
| 10 | **Building blocks** | `components/` | Buttons, switches, status pills, chips, messages, voices, tabs, icons |

## How the card works (the short version)

1. The signer turns Ola **on**. The card goes *Starting camera* → *Ready*.
2. Hands appear: *Seeing you*. When they move like a sign: *Signing*.
3. The sign ends and is named on the device: *Recognising* → a chip appears in the row.
4. After a pause, the chips become one sentence: *Writing your sentence* → *Sentence ready*.
5. The sentence is spoken (*Speaking*) and shown as a caption. In "Confirm first" mode it waits for **Speak**.
6. Problems are drawn on the camera picture, one at a time by priority. Nothing in the card changes size.

Every status has an icon **and** words, never colour alone, and is announced politely to screen readers.

## Open it, rebuild it, retake the pictures

```bash
pnpm --filter @audion/extension build:gallery      # rebuilds ui-components/index.html
node apps/extension/scripts/gallery-shots.mjs      # retakes every PNG (about a minute)
```

The picture script uses the Chromium that Playwright already installed. It needs no network and never asks for a camera.

## What the gallery is not

- **Not a recording of the real thing.** The camera preview shows a drawn hand, not a person, and the first-run set-up uses a drawn stand-in camera so the gallery never asks for permission.
- **Not every hover.** Tooltips, the meeting-context hover panel and the language menu's open list only appear on interaction; open `index.html` to try them (the tiles clip pop-ups).
- **Not the extension inside Google Meet.** These are the panel's own states; the page around it (Meet) is not drawn.
- **Looks drift.** Pictures are taken at one moment. Retake them after any visual change.

# Collecting webcam sign data: plan (DRAFT)

**Status: DRAFT.** The vocabulary it refers to was reviewed by the project owner (see `meeting-vocabulary.md`), but this plan
itself, and above all the consent text, still need review by an ethics process, a lawyer and the Deaf community before
anyone is recorded. This is not legal advice.

## Why

Ola's classifier learned from phone video (PopSign) but will be used on laptop webcams, in offices and at home, with the
signer seated. We cannot know the real accuracy, or fix the gap, without data recorded the way it will be used.

## What is recorded, and what is not

- Recorded: hand points (21 per hand) and, once the pose model is adopted, face and shoulder points, for each sign. These are numbers computed in the
  signer's own browser. The video is never saved or uploaded.
- Even hand points are personal data. They are kept only with the signer's agreement, labelled with a random ID, never with a name or e-mail.
- Not recorded: video, audio, faces as pictures, location, device details beyond the browser name.

## Who and how many

- Aim: at least 10 signers (different skin tones, hand sizes, ages, signing styles), more is better; signers recruited through and paid fairly, with the Deaf community involved in the design.
- Each signer signs every word and phrase on the approved list (see `meeting-vocabulary.md`), 5 repeats each, in two sessions on different days with different lighting.
- A held-out set: a few signers are used only for testing, never for training.

## Consent (plain words, to be reviewed)

Before recording, the signer sees and must agree to, in ASL video and in writing:

1. What is collected (hand and face points, no video) and why (to make Ola more accurate).
2. Who sees it, where it is stored, how long, and that it will not be sold or used to identify them.
3. They can stop at any time and ask for their data to be deleted, up to a stated date.
4. Whether the data may be shared with researchers (a separate, optional tick).

## Tool

A small recording page (not built yet): shows a word, counts down, records the hand points in the browser, shows them back for the signer to accept or redo, and sends only the points with the random ID. The development harness already has a "Record landmarks" button for hand points.

## Measures

Per-word accuracy on the held-out signers on webcams; wrong-spoken sentences per 100; delay from the end of a sign to the voice.

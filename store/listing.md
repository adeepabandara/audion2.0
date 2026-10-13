# Chrome Web Store listing (draft)

Everything here is ready to paste into the Web Store developer dashboard. Fill the `[brackets]`.

## Basics

- **Name:** Audion
- **Category:** Accessibility
- **Language:** English
- **Summary (max 132 characters):** Sign to your camera in Google Meet. Audion turns your signs into captions and a spoken voice in the call.
  (118 characters)

## Description

Audion lets a Deaf or hard-of-hearing person who signs American Sign Language be heard in Google Meet.

Turn Audion on, sign to your camera, and Audion:

- recognises each sign (22 common signs to start: hello, bye, yes, no, please, thank you, wait, why, who, where, now, later, tomorrow, time, finish, think, look, listen, talk, fine, same, not),
- joins them into one natural English sentence,
- shows it to you as a caption, and
- speaks it into the call in a voice you choose.

Made to be used: every control works with the keyboard, status is never shown by colour alone, captions are announced
politely to screen readers, and animations respect your reduced-motion setting.

Privacy: your video is processed to recognize signs and is never stored. Hand tracking runs on your device; only a short
clip of one sign is sent to be recognised, kept in memory for the request, and discarded.

Good to know:

- Recognition works best with slow, deliberate signs, good light, and your hands inside the on-screen outline.
- Other people in the call hear your voice (so Meet's own captions can caption it). They do not see Audion's caption bar.
  You can optionally post sentences to the Meet chat.
- Reload your Meet tab once after installing so Audion's voice can join your microphone.
- Meet's own mute switch also mutes Audion's voice.
- Audion's sign recognition is an early model and will make mistakes; it asks you to confirm signs it is unsure about.

Audion is not affiliated with Google. Google Meet is a trademark of Google LLC.

## Single purpose

Help signers be heard in Google Meet by recognising signs from the camera and turning them into captions and speech in the call.

## Permission justifications

| Permission or access                                                       | Why                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`                                                                  | Saves the user's settings (voice, speed, caption options, theme, panel position).                                                                                              |
| Host access to the Audion service (`https://[your-api-host]/*`)            | Sends one short clip of one sign for recognition, sends recognised words to make a sentence and a voice, and receives the results. No other site is contacted.                 |
| Content scripts on `https://meet.google.com/*`                             | Shows the panel and caption bar in the call, reads Meet's control bar to avoid covering it, and (optionally) posts a sentence to Meet's chat.                                  |
| A script in the page's own context on `meet.google.com`, at document start | Lets Audion's synthetic voice become part of the audio track Meet sends, mixed with the user's real microphone. Without it other people cannot hear Audion.                    |
| Web-accessible `tracker.html`                                              | Runs hand tracking in an isolated extension page that the Meet tab embeds, so it does not slow down Meet.                                                                      |
| Camera and microphone                                                      | Requested by Chrome for Google Meet's own page; Audion uses the camera to see signs and mixes the microphone with its voice. Audion never records or uploads microphone audio. |

No remote code is loaded. The extension's content-security policy only allows its own scripts (plus WebAssembly for hand tracking), and
network access only to the Audion service.

## Data disclosures (Developer dashboard > Privacy)

Answer after legal review, using `PRIVACY.md`. Likely: the extension handles _user activity or website content_ in the
form of short video clips and text, uses them only to provide the single purpose, does not sell them, does not use them
for unrelated purposes, and does not use them for creditworthiness or lending.

## Assets

- Icon: `apps/extension/public/icon/128.png`
- Screenshots (1280x800): `store/screenshots/` (the call page is a simulated Meet-like page used for testing, with invented participant names; replace with real captures if you prefer)
- Small promo tile (440x280): `store/promo-small-440x280.png`
- Marquee (1400x560): `store/promo-marquee-1400x560.png`
- Regenerate with: `pnpm --filter @audion/e2e build-extension && pnpm --filter @audion/e2e store-assets`

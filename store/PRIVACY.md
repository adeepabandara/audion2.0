# Audion privacy policy (DRAFT)

> **Draft for review.** This describes what the current code does. It is not legal advice. Before publishing, have it
> reviewed for the places you operate (for example GDPR and CCPA), fill in the `[bracketed]` items, host it at a public
> URL, and link that URL in the Chrome Web Store listing.

_Last updated: [date]_

## In one paragraph

Audion helps a person who signs American Sign Language be heard in Google Meet. It looks at your camera to
recognise one sign at a time, turns the signs into an English sentence, shows it to you as a caption and speaks it into
your call. **Your video is processed to recognize signs and is never stored.**

## What Audion processes, and where it goes

| Data                                                             | What happens to it                                                                                                                                                                                                                          | Leaves your device?            | Stored?                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Camera video                                                     | Hand positions are found **on your device** (MediaPipe runs inside the extension).                                                                                                                                                          | No                             | No                                                                                                                |
| Short clips of you signing (about 1 to 5 seconds, one sign each) | Sent over HTTPS to the Audion service, which passes the clip to Google's Gemini model on Google Cloud (Vertex AI) to recognise the sign.                                                                                                    | Yes                            | No. Kept in memory only for the length of the request, then discarded. Never written to disk or to Cloud Storage. |
| The recognised sign words, and the sentence made from them       | Sent to the Audion service, then to Gemini (to make a sentence) and to Google Cloud Text-to-Speech (to make the voice).                                                                                                                     | Yes                            | Not stored by Audion's code. The text is not written to its logs.                                                 |
| Your microphone                                                  | Audion never records it and never sends it to the Audion service. In your browser, your real microphone and Audion's synthetic voice are mixed into the one audio track that Google Meet sends, exactly as Meet would send your microphone. | Only to the call, via Meet     | No                                                                                                                |
| Settings (voice, speed, captions, theme, and similar)            | Saved with Chrome's extension storage, so Chrome may sync them between your own devices.                                                                                                                                                    | Via Chrome sync, if you use it | In your browser                                                                                                   |
| A random install ID                                              | A random identifier with no personal data, used to rate-limit requests and issue short-lived access tokens.                                                                                                                                 | Yes                            | In your browser (local storage)                                                                                   |
| The call transcript (what Audion said for you)                   | Kept in the browser's memory for that tab so it can be shown in the end-of-call summary.                                                                                                                                                    | No                             | Not on disk. Cleared when you close the summary or the tab, or when the browser closes.                           |
| Feedback (thumbs up or down)                                     | Only if you turn on feedback in Settings. Sends your rating and the sign words, **never video and never your sentences**.                                                                                                                   | Yes, if enabled                | The Audion service writes the rating and sign words to its log line.                                              |

## Logs

The Audion service logs request identifiers, timings, error codes, sign words (for recognition results and feedback)
and ratings. It does not log video, clip bytes, sentences or authorization tokens. Google Cloud's own
infrastructure (Cloud Run) records standard request metadata, which can include the requester's IP address and the
request path. [Confirm the retention period of your Cloud Run request logs.]

## Third parties

- **Google Cloud** (Vertex AI Gemini, Cloud Text-to-Speech, Cloud Run) processes clips and text on Audion's behalf.
  [State the region(s) used and link Google's data-processing terms. Check your Vertex AI settings for any
  prompt logging or caching, and for the "global" endpoint's lack of a fixed processing location.]
- **Google Meet** receives the audio and, if you choose "Also post sentences to Meet chat", the sentences you
  post. Audion only reads and writes the page of Meet in your own tab.
- Audion's recognition model was tuned using **PopSign ASL v1.0** (CC BY 4.0), by Georgia Tech and the Deaf
  Professional Arts Network. No PopSign data is included in Audion or sent anywhere.

Audion does not sell data, does not show ads, does not use your data for advertising or credit decisions, and does not
send data to analytics services.

## Your choices

- Switch Audion **Off** in the panel, or close the tab, and the camera stops.
- Turn off **Speak into the call** to get captions only.
- **Also post sentences to Meet chat** is off by default.
- Feedback is off unless you turn it on.
- Uninstalling the extension removes its settings and install ID from your browser.

## Why Audion needs its permissions

- **Camera and microphone access** is requested from you by Chrome for Google Meet's page and the Audion setup page.
- **`storage`** saves your settings.
- **Access to `meet.google.com`** lets the panel, caption bar and voice appear in your call.
- **Access to the Audion service** sends clips and text for recognition, sentences and speech.

## Children

Audion is not directed to children under 13 and does not knowingly collect their data. [Confirm for your
audience.]

## Changes and contact

If this policy changes, the date above changes and material changes will be announced in the extension's description.

Contact: [your name or organisation, and an email address]

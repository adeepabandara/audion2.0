/**
 * Check that the four Ola voices exist in Google Cloud Text-to-Speech, and optionally write one short sample of
 * each so you can listen. Listing voices is free; --speak synthesizes ~50 characters per voice (a fraction of a
 * cent in total).
 *
 *   gcloud auth application-default login
 *   GOOGLE_CLOUD_QUOTA_PROJECT=<project> pnpm --filter @audion/api voices
 *   GOOGLE_CLOUD_QUOTA_PROJECT=<project> pnpm --filter @audion/api voices --speak --out ~/ola-voice-samples
 *
 * With your own login (Application Default Credentials from `gcloud auth application-default login`) Google needs to
 * know which project to bill and enable the API on: GOOGLE_CLOUD_QUOTA_PROJECT does that. On Cloud Run the service
 * account does not need it.
 */
import { VOICES } from '@audion/shared';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, str } from './args.js';

const { flags } = parseArgs(process.argv.slice(2));
const client = new TextToSpeechClient();

try {
  const [res] = await client.listVoices({ languageCode: 'en-US' });
  const known = new Map(
    (res.voices ?? []).map((v) => [v.name ?? '', String(v.ssmlGender ?? 'UNKNOWN')]),
  );
  console.log(`Google lists ${known.size} en-US voices.\n`);
  console.log('id       our gender  Google gender   voice name           available');
  let problems = 0;
  for (const v of VOICES) {
    const g = known.get(v.ttsName);
    const ok = g !== undefined && g.toLowerCase() === v.gender;
    if (!ok) problems++;
    console.log(
      `${v.id.padEnd(8)} ${v.gender.padEnd(11)} ${(g ?? '-').padEnd(15)} ${v.ttsName.padEnd(20)} ${
        g === undefined ? 'NO' : ok ? 'yes' : 'yes, but the gender differs'
      }`,
    );
  }
  const genders = VOICES.map((v) => v.gender);
  console.log(
    `\nSet: ${genders.filter((x) => x === 'female').length} female, ${genders.filter((x) => x === 'male').length} male.`,
  );
  if (problems) {
    console.error(`\n${problems} voice(s) need attention (see above).`);
    process.exitCode = 1;
  }

  if (flags.has('speak')) {
    const out = str(flags.get('out'));
    if (!out) {
      console.error('--speak needs --out <folder> for the sample files.');
      process.exit(2);
    }
    mkdirSync(out, { recursive: true });
    const text = 'Hello, I am signing with Ola. Please wait a moment.';
    for (const v of VOICES) {
      const [audio] = await client.synthesizeSpeech({
        input: { text },
        voice: { languageCode: v.languageCode, name: v.ttsName },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1 },
      });
      const bytes = Buffer.from(audio.audioContent as Uint8Array);
      const file = join(out, `${v.id}-${v.gender}.mp3`);
      writeFileSync(file, bytes);
      console.log(`wrote ${file} (${bytes.length} bytes)`);
    }
  }
} catch (e) {
  const err = e as { code?: number; message?: string };
  console.error(`\nText-to-Speech call failed: ${err.message ?? e}`);
  if (/SERVICE_DISABLED|has not been used|not enabled/i.test(String(err.message))) {
    console.error(
      'The Cloud Text-to-Speech API is not enabled on that project. Enabling it is your call (it is a project setting).',
    );
  } else if (/quota project|x-goog-user-project|PERMISSION_DENIED|403/i.test(String(err.message))) {
    console.error(
      'Try setting GOOGLE_CLOUD_QUOTA_PROJECT=<your project id> and make sure your account may use it.',
    );
  }
  process.exit(1);
}

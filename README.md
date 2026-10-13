# Audion

Sign. Be heard in any Google Meet call.

Audion is a Chrome extension (Manifest V3) that recognises isolated American Sign Language signs from your webcam, turns them into an English sentence, shows it as a caption and speaks it into the call.

**Privacy:** your video is processed to recognize signs and is never stored.

**Limitation:** other participants cannot see Audion's local overlay. They hear the voice (so Meet's own live captions caption it) and can optionally receive sentences in Meet chat.

Status: M4 (API with mock mode, design system, onboarding pages, panel and pill on Meet). See [CLAUDE.md](CLAUDE.md) for architecture and rules.

## Development

```bash
pnpm install
pnpm check   # build, typecheck, lint, test
```

Copy `.env.example` to `.env` for local API settings. Never commit `.env` or any key.

### Try it locally (mock mode, no Google Cloud)

```bash
pnpm build                                                 # builds shared + everything once
ALLOWED_ORIGINS='*' MOCK=1 pnpm --filter @audion/api dev   # API on :8080
pnpm --filter @audion/extension build                      # then load apps/extension/.output/chrome-mv3
                                                           # via chrome://extensions > Developer mode > Load unpacked
```

The welcome page opens on install. Storybook: `pnpm --filter @audion/ui storybook`.

To try the panel without a real call: `pnpm --filter @audion/extension harness`, then `pnpm --filter @audion/fake-meet dev` and open http://localhost:4173. To run the real extension on the fake page, build with `AUDION_FAKE_MEET=1`.

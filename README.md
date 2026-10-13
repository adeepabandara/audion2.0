# Audion

Sign. Be heard in any Google Meet call.

Audion is a Chrome extension (Manifest V3) that recognises isolated American Sign Language signs from your webcam, turns them into an English sentence, shows it as a caption and speaks it into the call.

**Privacy:** your video is processed to recognize signs and is never stored.

**Limitation:** other participants cannot see Audion's local overlay. They hear the voice (so Meet's own live captions caption it) and can optionally receive sentences in Meet chat.

Status: M0 (foundations). See [CLAUDE.md](CLAUDE.md) for architecture and rules.

## Development

```bash
pnpm install
pnpm check   # build, typecheck, lint, test
```

Copy `.env.example` to `.env` for local API settings. Never commit `.env` or any key.

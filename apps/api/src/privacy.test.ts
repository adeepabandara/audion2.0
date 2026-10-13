import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getToken, makeApp, multipartBody } from './testUtils.js';

const srcDir = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('testUtils.ts') ? [p] : [];
  });
}

describe('clip privacy', () => {
  it('never logs clip bytes or the Authorization header', async () => {
    const lines: string[] = [];
    const { app } = await makeApp({}, { write: (m) => void lines.push(m) }, 'trace');
    const token = await getToken(app);
    const marker = 'AUDION-CLIP-MARKER-9f3a7c';
    const { payload, headers } = multipartBody({ mime: 'video/webm' }, Buffer.from(marker));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recognize',
      headers: { ...headers, authorization: `Bearer ${token}` },
      payload,
    });
    expect(res.statusCode).toBe(200);
    await app.close();

    const logs = lines.join('\n');
    expect(logs).toContain('recognized'); // logging is on, so the assertions below mean something
    expect(logs).not.toContain(marker);
    expect(logs).not.toContain(Buffer.from(marker).toString('base64'));
    expect(logs).not.toContain(Buffer.from(marker).toString('hex'));
    expect(logs).not.toContain(token);
  });

  it('has no code path that can write to disk or spawn processes', () => {
    const forbidden =
      /from ['"](node:)?(fs|fs\/promises|child_process|os)['"]|require\(['"](node:)?fs|writeFile|createWriteStream|tmpdir/;
    const offenders = sourceFiles(srcDir).filter((f) => forbidden.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

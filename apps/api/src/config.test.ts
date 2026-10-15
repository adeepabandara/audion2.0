import { describe, expect, it } from 'vitest';
import { checkLiveConfig, loadConfig } from './config.js';
import { createRecognizer, createServices } from './services/index.js';

const prod = { JWT_SECRET: 'x'.repeat(20), ALLOWED_ORIGINS: 'chrome-extension://abc' };

describe('live mode configuration', () => {
  it('refuses to start live with an empty project, and says what to do', () => {
    expect(() =>
      createServices(loadConfig({ MOCK: '0', GCP_PROJECT_ID: '', JWT_SECRET: 'x'.repeat(20) })),
    ).toThrow(/GCP_PROJECT_ID/);
  });

  it('builds live services without any network call or key (credentials are resolved lazily via ADC)', () => {
    const s = createServices(loadConfig({ GCP_PROJECT_ID: 'p', MOCK: '0', ...prod }));
    expect(s.mode).toBe('live');
  });
});

describe('recognizer configuration', () => {
  it('follows MOCK when RECOGNIZER_MODE is unset: mock in dev, base in live', () => {
    expect(loadConfig({ MOCK: '1' }).recognizer.mode).toBe('mock');
    expect(loadConfig({ MOCK: '0' }).recognizer.mode).toBe('base');
    expect(loadConfig({ MOCK: '1', RECOGNIZER_MODE: 'base' }).recognizer.mode).toBe('base');
  });

  it('has the documented defaults', () => {
    const r = loadConfig({}).recognizer;
    expect(r).toMatchObject({
      tunedLocation: 'us',
      baseModel: 'gemini-3.5-flash',
      baseLocation: 'global',
      maxOutputTokens: 2048,
      timeoutMs: 15_000,
      fallback: 'none',
      dailyCallCap: 500,
    });
    expect(loadConfig({}).gcpProject).toBe('audion-511503');
    expect(loadConfig({ GCP_PROJECT: 'old-name' }).gcpProject).toBe('old-name');
    expect(loadConfig({ GCP_PROJECT_ID: 'new', GCP_PROJECT: 'old' }).gcpProject).toBe('new');
  });

  it('thinking level is unset by default and accepts minimal, low, medium, high', () => {
    expect(loadConfig({}).recognizer.thinkingLevel).toBeUndefined();
    expect(loadConfig({ RECOGNIZE_THINKING_LEVEL: 'minimal' }).recognizer.thinkingLevel).toBe(
      'minimal',
    );
    expect(() => loadConfig({ RECOGNIZE_THINKING_LEVEL: 'extreme' })).toThrow(
      /RECOGNIZE_THINKING_LEVEL/,
    );
  });

  it('compose thinking level is optional too', () => {
    expect(loadConfig({}).compose.thinkingLevel).toBeUndefined();
    expect(loadConfig({ COMPOSE_THINKING_LEVEL: 'minimal' }).compose.thinkingLevel).toBe('minimal');
  });

  it('tuned mode needs a numeric TUNED_ENDPOINT_ID and fails with a clear message', () => {
    expect(() => loadConfig({ RECOGNIZER_MODE: 'tuned' })).toThrow(/needs TUNED_ENDPOINT_ID/);
    expect(() => loadConfig({ RECOGNIZER_MODE: 'tuned', TUNED_ENDPOINT_ID: '  ' })).toThrow(
      /needs TUNED_ENDPOINT_ID/,
    );
    expect(() =>
      loadConfig({
        RECOGNIZER_MODE: 'tuned',
        TUNED_ENDPOINT_ID: 'projects/1/locations/us/endpoints/2',
      }),
    ).toThrow(/numeric endpoint ID/);
    const c = loadConfig({ RECOGNIZER_MODE: 'tuned', TUNED_ENDPOINT_ID: '123456789' });
    expect(c.recognizer).toMatchObject({ mode: 'tuned', tunedEndpointId: '123456789' });
  });

  it('does not need an endpoint ID in base or mock mode', () => {
    expect(() => loadConfig({ RECOGNIZER_MODE: 'base' })).not.toThrow();
    expect(() => loadConfig({ RECOGNIZER_MODE: 'mock' })).not.toThrow();
  });

  it('reports bad values as readable text, not a JSON dump', () => {
    expect(() => loadConfig({ RECOGNIZER_MODE: 'turbo' })).toThrow(/RECOGNIZER_MODE/);
    expect(() => loadConfig({ DAILY_CALL_CAP: '0' })).toThrow(/DAILY_CALL_CAP/);
    expect(() => loadConfig({ RECOGNIZE_TIMEOUT_MS: '5' })).toThrow(/RECOGNIZE_TIMEOUT_MS/);
    try {
      loadConfig({ RECOGNIZER_MODE: 'turbo' });
    } catch (e) {
      expect((e as Error).message.startsWith('[')).toBe(false);
    }
  });

  it('picks the implementation from the mode (nothing is called while building)', () => {
    const mk = (env: Record<string, string>) =>
      createRecognizer(loadConfig({ JWT_SECRET: 'x'.repeat(20), ...env }));
    expect(mk({ RECOGNIZER_MODE: 'mock' }).modelId).toBe('mock');
    expect(mk({ RECOGNIZER_MODE: 'base' }).modelId).toBe('gemini-3.5-flash');
    expect(mk({ RECOGNIZER_MODE: 'tuned', TUNED_ENDPOINT_ID: '42' }).modelId).toBe('tuned:42');
    expect(
      mk({ RECOGNIZER_MODE: 'tuned', TUNED_ENDPOINT_ID: '42', RECOGNIZER_FALLBACK: 'base' })
        .modelId,
    ).toBe('tuned:42');
  });
});

describe('production safety checks', () => {
  const base = { GCP_PROJECT_ID: 'p', MOCK: '0', ...prod };

  it('refuses the public development JWT secret', () => {
    const noSecret: Record<string, string> = { ...base };
    delete noSecret.JWT_SECRET;
    expect(() => createServices(loadConfig(noSecret))).toThrow(/JWT_SECRET/);
    expect(checkLiveConfig(loadConfig(noSecret)).errors.join()).toMatch(/Secret Manager/);
  });

  it('refuses an empty origin allow-list (every request would be rejected) and warns about *', () => {
    expect(() => createServices(loadConfig({ ...base, ALLOWED_ORIGINS: '' }))).toThrow(
      /ALLOWED_ORIGINS/,
    );
    const c = loadConfig({ ...base, ALLOWED_ORIGINS: '*' });
    expect(checkLiveConfig(c).errors).toEqual([]);
    expect(checkLiveConfig(c).warnings.join()).toMatch(/any origin/);
  });

  it('reports every problem at once', () => {
    const c = loadConfig({ MOCK: '0', GCP_PROJECT_ID: '' });
    expect(checkLiveConfig(c).errors).toHaveLength(3);
  });
});

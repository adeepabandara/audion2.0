import { describe, expect, it } from 'vitest';
import { checkLiveConfig, loadConfig } from './config.js';
import { createServices } from './services/index.js';

const prod = { JWT_SECRET: 'x'.repeat(20), ALLOWED_ORIGINS: 'chrome-extension://abc' };

describe('live mode configuration', () => {
  it('refuses to start live without a project, and says what to do', () => {
    expect(() => createServices(loadConfig({ MOCK: '0', JWT_SECRET: 'x'.repeat(20) }))).toThrow(
      /GCP_PROJECT/,
    );
  });

  it('reads model and location settings (base model global, tuned endpoint in its own region)', () => {
    const c = loadConfig({
      GCP_PROJECT: 'p',
      RECOGNIZE_MODEL: 'projects/1/locations/us-central1/endpoints/2',
      RECOGNIZE_LOCATION: 'us-central1',
      ...prod,
    });
    expect(c.recognize).toEqual({
      model: 'projects/1/locations/us-central1/endpoints/2',
      location: 'us-central1',
    });
    expect(c.compose).toEqual({ model: 'gemini-3.5-flash', location: 'global' });
  });

  it('builds live services without any network call or key (credentials are resolved lazily via ADC)', () => {
    const s = createServices(loadConfig({ GCP_PROJECT: 'p', MOCK: '0', ...prod }));
    expect(s.mode).toBe('live');
  });
});

describe('production safety checks', () => {
  const base = { GCP_PROJECT: 'p', MOCK: '0', ...prod };

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
    const c = loadConfig({ MOCK: '0' });
    expect(checkLiveConfig(c).errors).toHaveLength(3);
  });
});

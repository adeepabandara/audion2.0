import { buildApp } from './app.js';
import { checkLiveConfig, loadConfig } from './config.js';
import { createServices } from './services/index.js';

let config: ReturnType<typeof loadConfig>;
let services: ReturnType<typeof createServices>;
try {
  config = loadConfig();
  services = createServices(config);
  if (!config.mock)
    for (const w of checkLiveConfig(config).warnings) console.warn(`Audion API warning: ${w}`);
} catch (e) {
  // A clear one-line reason beats a stack trace in Cloud Run's startup logs.
  console.error(`Audion API cannot start: ${(e as Error).message}`);
  process.exit(1);
}

const app = await buildApp(config, services);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}

await app.listen({ port: config.port, host: '0.0.0.0' });

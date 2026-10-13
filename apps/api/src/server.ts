import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createServices } from './services/index.js';

const config = loadConfig();
const app = await buildApp(config, createServices(config));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}

await app.listen({ port: config.port, host: '0.0.0.0' });

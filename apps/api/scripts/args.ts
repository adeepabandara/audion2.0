import { loadConfig } from '../src/config.js';

/** Tiny `--flag value` / `--flag` parser for the dev scripts. */
export function parseArgs(argv: string[]): { flags: Map<string, string | true>; rest: string[] } {
  const flags = new Map<string, string | true>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      rest.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
    const next = argv[i + 1];
    if (inline !== undefined) flags.set(name, inline);
    else if (next !== undefined && !next.startsWith('--')) {
      flags.set(name, next);
      i++;
    } else flags.set(name, true);
  }
  return { flags, rest };
}

export const str = (v: string | true | undefined): string | undefined =>
  typeof v === 'string' ? v : undefined;

export function mimeFor(file: string): string | undefined {
  const ext = file.toLowerCase().split('.').pop();
  return ext === 'mp4'
    ? 'video/mp4'
    : ext === 'webm'
      ? 'video/webm'
      : ext === 'mov'
        ? 'video/quicktime'
        : undefined;
}

/** The host @google/genai uses for a Vertex location (global, multi-region us/eu, or a single region). */
export function vertexHost(location: string): string {
  if (location === 'global') return 'aiplatform.googleapis.com';
  if (location === 'us' || location === 'eu') return `aiplatform.${location}.rep.googleapis.com`;
  return `${location}-aiplatform.googleapis.com`;
}

/** loadConfig, but a bad setting prints one line and exits instead of a stack trace. */
export function loadConfigOrExit(env: Record<string, string | undefined>) {
  try {
    return loadConfig(env);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}

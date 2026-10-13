import { AppError } from '../../errors.js';

/**
 * Give a model or speech call a deadline. The caller also passes the signal on (where the SDK supports it) so the
 * request is actually cancelled; the race guarantees we answer within `ms` either way.
 */
export async function withTimeout<T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ctl = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new AppError('MODEL_UNAVAILABLE', 'The model took too long to answer, try again.'));
    }, ms);
  });
  try {
    return await Promise.race([run(ctl.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export const TIMEOUTS = { recognizeMs: 30_000, composeMs: 20_000, speakMs: 15_000 } as const;

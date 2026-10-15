import type { ErrorCode, ErrorResponse } from '@audion/shared';

const STATUS: Record<ErrorCode, number> = {
  RATE_LIMITED: 429,
  CLIP_TOO_LARGE: 413,
  MODEL_UNAVAILABLE: 503,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  DAILY_CAP_REACHED: 429,
};

const RETRYABLE: Record<ErrorCode, boolean> = {
  RATE_LIMITED: true,
  CLIP_TOO_LARGE: false,
  MODEL_UNAVAILABLE: true,
  BAD_REQUEST: false,
  UNAUTHENTICATED: false,
  DAILY_CAP_REACHED: false,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  /** HTTP status the upstream model API answered with (logged server-side, never sent to the client). */
  readonly upstreamStatus?: number;
  constructor(code: ErrorCode, message: string, upstreamStatus?: number) {
    super(message);
    this.code = code;
    this.upstreamStatus = upstreamStatus;
  }
  get status(): number {
    return STATUS[this.code];
  }
  toResponse(): ErrorResponse {
    return {
      error: { code: this.code, message: this.message, retryable: RETRYABLE[this.code] },
    };
  }
}

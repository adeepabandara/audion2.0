import type { ErrorCode, ErrorResponse } from '@audion/shared';

const STATUS: Record<ErrorCode, number> = {
  RATE_LIMITED: 429,
  CLIP_TOO_LARGE: 413,
  MODEL_UNAVAILABLE: 503,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
};

const RETRYABLE: Record<ErrorCode, boolean> = {
  RATE_LIMITED: true,
  CLIP_TOO_LARGE: false,
  MODEL_UNAVAILABLE: true,
  BAD_REQUEST: false,
  UNAUTHENTICATED: false,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
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

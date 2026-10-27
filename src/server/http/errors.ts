export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthenticated"
  | "email_not_verified"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "unsupported_media_type"
  | "rate_limited"
  | "quota_exceeded"
  | "plan_required"
  | "provider_unavailable"
  | "provider_error"
  | "invalid_audio"
  | "internal_error";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  email_not_verified: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  quota_exceeded: 429,
  plan_required: 402,
  provider_unavailable: 503,
  provider_error: 502,
  invalid_audio: 422,
  internal_error: 500,
};

/** An error that is safe to show to the client. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export const notFound = (what = "Resource") => new AppError("not_found", `${what} not found`);

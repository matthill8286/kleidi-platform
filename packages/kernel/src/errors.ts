export type ErrorCode =
  | "unauthenticated"
  | "two_factor_required"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid"
  | "expired"
  | "precondition_required"
  | "precondition_failed";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  two_factor_required: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid: 422,
  expired: 410,
  precondition_required: 428,
  precondition_failed: 412,
};

/** A failure the caller can act on. The API turns it into an RFC 9457 problem response. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
  }
}

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

export type MessageParams = Record<string, string | number>;

/** A user-facing message: a key the web app translates, and the English text as fallback. */
export type Message = { key: string; text: string; params?: MessageParams };

/**
 * A failure the caller can act on. The API turns it into an RFC 9457 problem response.
 * `key` names the translation in the web app's `errors` strings.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly key: string | undefined;
  readonly params: MessageParams | undefined;

  constructor(code: ErrorCode, message: string, key?: string, params?: MessageParams) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.key = key;
    this.params = params;
  }

  static from(code: ErrorCode, message: Message): AppError {
    return new AppError(code, message.text, message.key, message.params);
  }
}

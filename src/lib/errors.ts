/**
 * The application error model (doc 18 §18.9).
 *
 * Two rules shape this file:
 *
 *  1. **Errors never leak internals to a client.** Every error carries a public `code` and a
 *     safe `publicMessage`; anything diagnostic lives in `context`, which is logged and never
 *     serialised into a response (`SENS-SEC-016`).
 *  2. **A resource the actor does not own is a 404, not a 403.** Returning 403 confirms the
 *     resource exists, which is itself a disclosure (doc 23 §23.4).
 */

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PRECONDITION_FAILED"
  | "EXTERNAL_VERIFICATION_REQUIRED"
  | "INTERNAL";

const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PRECONDITION_FAILED: 412,
  EXTERNAL_VERIFICATION_REQUIRED: 409,
  INTERNAL: 500,
};

export interface AppErrorOptions {
  readonly publicMessage?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.publicMessage = options.publicMessage ?? defaultPublicMessage(code);
    this.context = options.context ?? {};
  }

  /** The only shape ever sent to a client. */
  toPublicJSON(): { readonly code: ErrorCode; readonly message: string } {
    return { code: this.code, message: this.publicMessage };
  }
}

function defaultPublicMessage(code: ErrorCode): string {
  switch (code) {
    case "VALIDATION_FAILED":
      return "Some of the values submitted were not valid.";
    case "UNAUTHENTICATED":
      return "You need to be signed in to do that.";
    case "NOT_FOUND":
      return "That was not found.";
    case "CONFLICT":
      return "That conflicts with the current state.";
    case "RATE_LIMITED":
      return "Too many attempts. Please wait a moment and try again.";
    case "PRECONDITION_FAILED":
      return "This action is not available in the current state.";
    case "EXTERNAL_VERIFICATION_REQUIRED":
      return "We do not have a verified sensitivity model for this game yet.";
    case "INTERNAL":
      return "Something went wrong on our side.";
  }
}

/** Field-level validation failures, safe to return because the client sent the values. */
export interface FieldIssue {
  readonly path: string;
  readonly message: string;
}

export class ValidationError extends AppError {
  readonly issues: readonly FieldIssue[];

  constructor(issues: readonly FieldIssue[], options: AppErrorOptions = {}) {
    super("VALIDATION_FAILED", `validation failed: ${issues.length} issue(s)`, options);
    this.name = "ValidationError";
    this.issues = issues;
  }

  override toPublicJSON(): {
    readonly code: ErrorCode;
    readonly message: string;
    readonly issues: readonly FieldIssue[];
  } {
    return { ...super.toPublicJSON(), issues: this.issues };
  }
}

export const notFound = (resource: string, context?: Readonly<Record<string, unknown>>): AppError =>
  new AppError("NOT_FOUND", `${resource} not found`, context === undefined ? {} : { context });

export const unauthenticated = (detail = "no active session"): AppError =>
  new AppError("UNAUTHENTICATED", detail);

export const conflict = (detail: string, context?: Readonly<Record<string, unknown>>): AppError =>
  new AppError("CONFLICT", detail, context === undefined ? {} : { context });

export const rateLimited = (retryAfterSeconds: number): AppError =>
  new AppError("RATE_LIMITED", "rate limit exceeded", {
    context: { retryAfterSeconds },
  });

export const preconditionFailed = (
  detail: string,
  context?: Readonly<Record<string, unknown>>,
): AppError =>
  new AppError("PRECONDITION_FAILED", detail, context === undefined ? {} : { context });

export const internal = (detail: string, cause?: unknown): AppError =>
  new AppError("INTERNAL", detail, cause === undefined ? {} : { cause });

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Normalises anything thrown into an `AppError`.
 *
 * Unknown throwables become `INTERNAL` with their detail preserved for logs only — never
 * echoed to the client.
 */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  if (value instanceof Error) return internal(value.message, value);
  return internal(`non-error thrown: ${String(value)}`, value);
}

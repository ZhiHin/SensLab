/**
 * Structured logging (doc 18 §18.9, `SENS-NFR-034`).
 *
 * Deliberately small and dependency-free. What matters is not the feature set but two
 * guarantees:
 *
 *  - **Correlation.** Every log line carries the identifiers needed to reconstruct what a
 *    user was doing: session, round, trace.
 *  - **Redaction.** Secrets, tokens, emails and raw telemetry never reach a log. The
 *    redactor runs over every field on every call rather than relying on call sites to
 *    remember (`SENS-SEC-024`).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogContext {
  readonly traceId?: string;
  readonly sessionId?: string;
  readonly roundId?: string;
  readonly userId?: string;
  readonly [key: string]: unknown;
}

/** Field names whose values are never logged, matched case-insensitively as substrings. */
const REDACTED_KEY_PATTERNS = [
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "email",
  "hash",
  "salt",
  "credential",
  "apikey",
  "api_key",
];

const REDACTED = "[redacted]";

function shouldRedact(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACTED_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Recursively redacts a value.
 *
 * Arrays of more than 32 numbers are replaced with a summary: that shape is what raw pointer
 * telemetry looks like, and it must never reach a log (`SENS-BR-032`).
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[max depth]";
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    if (value.length > 32 && value.every((item) => typeof item === "number")) {
      return `[${value.length} numeric samples omitted]`;
    }
    return value.slice(0, 32).map((item) => redact(item, depth + 1));
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = shouldRedact(key) ? REDACTED : redact(item, depth + 1);
    }
    return out;
  }

  return value;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Returns a logger that merges `context` into every subsequent line. */
  child(context: LogContext): Logger;
}

export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly time: string;
  readonly context: Record<string, unknown>;
}

export type LogSink = (record: LogRecord) => void;

/**
 * Emits one JSON object per line — the shape log aggregators expect.
 *
 * Writes to stdout rather than `console` so the transport is explicit and so the `no-console`
 * lint rule can stay on as an error everywhere else in the codebase.
 */
export const jsonSink: LogSink = (record) => {
  const line = JSON.stringify({
    level: record.level,
    time: record.time,
    msg: record.message,
    ...record.context,
  });
  if (typeof process !== "undefined" && process.stdout !== undefined) {
    process.stdout.write(`${line}\n`);
  }
};

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly sink?: LogSink;
  readonly base?: LogContext;
  readonly now?: () => Date;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const sink = options.sink ?? jsonSink;
  const base = options.base ?? {};
  const now = options.now ?? (() => new Date());
  const threshold = LEVEL_ORDER[level];

  const emit = (recordLevel: LogLevel, message: string, context?: LogContext): void => {
    if (LEVEL_ORDER[recordLevel] < threshold) return;
    const merged = redact({ ...base, ...(context ?? {}) }) as Record<string, unknown>;
    sink({ level: recordLevel, message, time: now().toISOString(), context: merged });
  };

  return {
    debug: (message, context) => emit("debug", message, context),
    info: (message, context) => emit("info", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, context) => emit("error", message, context),
    child: (context) =>
      createLogger({
        level,
        sink,
        base: { ...base, ...context },
        now,
      }),
  };
}

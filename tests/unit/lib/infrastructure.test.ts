import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/canonical-json";
import {
  AppError,
  ValidationError,
  conflict,
  internal,
  isAppError,
  notFound,
  rateLimited,
  toAppError,
  unauthenticated,
} from "@/lib/errors";
import { createLogger, redact, type LogRecord } from "@/lib/logger";
import { EnvironmentError, parseEnv } from "@/lib/env";
import { digestParameterSet, findParameterMismatches } from "@/lib/parameter-registry";
import { RELEASED_PARAMETER_SETS, SCORING_MODEL_V1 } from "@/core/params";
import { generateToken, hashToken, safeEquals, sha256 } from "@/lib/crypto";

describe("canonicalJson", () => {
  it("is independent of key insertion order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("sorts nested keys too", () => {
    expect(canonicalJson({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}');
  });

  it("preserves array order, which is meaningful", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined members rather than emitting them inconsistently", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("serialises bigints as strings", () => {
    expect(canonicalJson({ seed: 42n })).toBe('{"seed":"42"}');
  });

  it("refuses non-finite numbers instead of emitting null", () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ x: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });
});

describe("error model", () => {
  it("maps codes to the intended status", () => {
    expect(notFound("session").status).toBe(404);
    expect(unauthenticated().status).toBe(401);
    expect(conflict("nope").status).toBe(409);
    expect(rateLimited(30).status).toBe(429);
    expect(internal("boom").status).toBe(500);
  });

  it("never exposes internal detail in the public payload — SENS-SEC-016", () => {
    const error = notFound("hardware profile", { sql: "select * from users", userId: "u1" });
    const payload = error.toPublicJSON();
    expect(JSON.stringify(payload)).not.toContain("select");
    expect(JSON.stringify(payload)).not.toContain("u1");
    expect(payload.code).toBe("NOT_FOUND");
    expect(payload.message.length).toBeGreaterThan(0);
  });

  it("returns field issues for validation failures, which the client itself supplied", () => {
    const error = new ValidationError([{ path: "email", message: "enter a valid email address" }]);
    expect(error.status).toBe(422);
    expect(error.toPublicJSON().issues).toHaveLength(1);
  });

  it("carries the retry hint for a rate limit", () => {
    expect(rateLimited(42).context["retryAfterSeconds"]).toBe(42);
  });

  it("normalises anything thrown", () => {
    const fromApp = new AppError("CONFLICT", "x");
    expect(toAppError(fromApp)).toBe(fromApp);
    expect(toAppError(new Error("boom")).code).toBe("INTERNAL");
    expect(toAppError("a string").code).toBe("INTERNAL");
    expect(isAppError(new Error("boom"))).toBe(false);
  });

  it("provides a default public message for every code", () => {
    const codes = [
      "VALIDATION_FAILED",
      "UNAUTHENTICATED",
      "NOT_FOUND",
      "CONFLICT",
      "RATE_LIMITED",
      "PRECONDITION_FAILED",
      "EXTERNAL_VERIFICATION_REQUIRED",
      "INTERNAL",
    ] as const;
    for (const code of codes) {
      expect(new AppError(code, "internal detail").publicMessage.length, code).toBeGreaterThan(5);
    }
  });
});

describe("logger redaction — SENS-SEC-024", () => {
  const capture = (): { records: LogRecord[]; sink: (record: LogRecord) => void } => {
    const records: LogRecord[] = [];
    return { records, sink: (record) => records.push(record) };
  };

  it("redacts anything whose key looks like a secret", () => {
    const { records, sink } = capture();
    createLogger({ sink, level: "debug" }).info("x", {
      password: "hunter2",
      sessionToken: "abc",
      email: "a@b.c",
      ipHash: "deadbeef",
      safeValue: 42,
    });
    const context = records[0]?.context ?? {};
    expect(context["password"]).toBe("[redacted]");
    expect(context["sessionToken"]).toBe("[redacted]");
    expect(context["email"]).toBe("[redacted]");
    expect(context["ipHash"]).toBe("[redacted]");
    expect(context["safeValue"]).toBe(42);
  });

  it("summarises long numeric arrays rather than logging telemetry — SENS-BR-032", () => {
    const samples = Array.from({ length: 5000 }, (_, i) => i * 0.001);
    expect(redact({ samples })).toEqual({ samples: "[5000 numeric samples omitted]" });
  });

  it("truncates other long arrays", () => {
    const values = Array.from({ length: 100 }, (_, i) => ({ i }));
    const result = redact({ values }) as { values: unknown[] };
    expect(result.values).toHaveLength(32);
  });

  it("serialises errors usefully", () => {
    const result = redact(new Error("boom")) as { name: string; message: string };
    expect(result.name).toBe("Error");
    expect(result.message).toBe("boom");
  });

  it("bounds recursion depth", () => {
    let deep: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain("max depth");
  });

  it("honours the level threshold", () => {
    const { records, sink } = capture();
    const logger = createLogger({ sink, level: "warn" });
    logger.debug("no");
    logger.info("no");
    logger.warn("yes");
    logger.error("yes");
    expect(records.map((record) => record.level)).toEqual(["warn", "error"]);
  });

  it("merges child context into every line", () => {
    const { records, sink } = capture();
    createLogger({ sink }).child({ sessionId: "s1" }).info("x", { roundId: "r1" });
    expect(records[0]?.context).toMatchObject({ sessionId: "s1", roundId: "r1" });
  });
});

describe("environment validation", () => {
  const valid = {
    NODE_ENV: "test",
    APP_URL: "http://localhost:3000",
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    AUTH_SECRET: "a".repeat(48),
    ABUSE_HASH_SALT: "b".repeat(48),
  };

  it("accepts a complete environment and applies defaults", () => {
    const parsed = parseEnv(valid);
    expect(parsed.DATABASE_POOL_MAX).toBe(10);
    expect(parsed.LOG_LEVEL).toBe("info");
  });

  it("rejects a placeholder secret", () => {
    expect(() =>
      parseEnv({ ...valid, AUTH_SECRET: "replace-me-with-a-real-secret-value-here" }),
    ).toThrow(EnvironmentError);
  });

  it("rejects a short secret", () => {
    expect(() => parseEnv({ ...valid, ABUSE_HASH_SALT: "short" })).toThrow(EnvironmentError);
  });

  it("rejects a non-postgres database URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://x" })).toThrow(EnvironmentError);
  });

  it("rejects a malformed app URL", () => {
    expect(() => parseEnv({ ...valid, APP_URL: "not-a-url" })).toThrow(EnvironmentError);
  });

  it("names every offending variable in the message", () => {
    try {
      parseEnv({ ...valid, APP_URL: "nope", DATABASE_URL: "nope" });
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      const message = (error as Error).message;
      expect(message).toContain("APP_URL");
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain(".env.example");
    }
  });
});

describe("parameter integrity — SENS-BR-029", () => {
  it("hashes a parameter set deterministically", () => {
    const a = digestParameterSet(SCORING_MODEL_V1);
    const b = digestParameterSet(SCORING_MODEL_V1);
    expect(a.hashHex).toBe(b.hashHex);
    expect(a.hashHex).toHaveLength(64);
  });

  it("reports nothing when the database agrees", () => {
    const stored = [digestParameterSet(SCORING_MODEL_V1)].map((digest) => ({
      kind: digest.kind,
      versionLabel: digest.version,
      paramsHash: digest.hash,
    }));
    const problems = findParameterMismatches(stored);
    // Every other released set — current and historical — is missing from `stored`, so each
    // is reported; the one supplied is not.
    expect(problems.some((problem) => problem.includes("scoring_model_v1"))).toBe(false);
    expect(problems.length).toBe(RELEASED_PARAMETER_SETS.length - 1);
  });

  it("reports a hash mismatch", () => {
    const digest = digestParameterSet(SCORING_MODEL_V1);
    const problems = findParameterMismatches([
      { kind: digest.kind, versionLabel: digest.version, paramsHash: sha256("tampered") },
    ]);
    expect(problems.some((problem) => problem.includes("hash mismatch"))).toBe(true);
  });

  it("does not complain about historical versions the code no longer ships", () => {
    // Old versions must stay in the database so results generated under them remain
    // explainable (SENS-BR-020).
    const problems = findParameterMismatches([
      { kind: "scoring", versionLabel: "scoring_model_v0", paramsHash: sha256("old") },
      ...[digestParameterSet(SCORING_MODEL_V1)].map((digest) => ({
        kind: digest.kind,
        versionLabel: digest.version,
        paramsHash: digest.hash,
      })),
    ]);
    expect(problems.some((problem) => problem.includes("scoring_model_v0"))).toBe(false);
  });
});

describe("token hashing", () => {
  it("generates high-entropy, url-safe tokens", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(generateToken()).not.toBe(token);
  });

  it("peppers the hash so the database alone cannot verify a token", () => {
    const token = "some-token";
    expect(hashToken(token, "pepper-a").equals(hashToken(token, "pepper-b"))).toBe(false);
    expect(hashToken(token, "pepper-a").equals(hashToken(token, "pepper-a"))).toBe(true);
  });

  it("compares in constant time and rejects length mismatches", () => {
    const a = hashToken("x", "p");
    expect(safeEquals(a, hashToken("x", "p"))).toBe(true);
    expect(safeEquals(a, hashToken("y", "p"))).toBe(false);
    expect(safeEquals(a, Buffer.from("short"))).toBe(false);
  });
});

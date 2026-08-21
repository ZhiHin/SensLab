import { describe, expect, it } from "vitest";
import { err, isErr, isOk, mapOk, ok, unwrap } from "@/core/types/result";
import {
  centimetres,
  cmPer360,
  countsPer360,
  degrees,
  dpi,
  logSensitivity,
} from "@/core/types/brand";

/**
 * The Result type and the branded scalars.
 *
 * Result is the mechanism behind the verification gate: an adapter returns a discriminated
 * union so that "I forgot to handle the failure" is a type error rather than a number
 * appearing where none should (doc 12 §12.6). These tests cover its runtime behaviour; the
 * type-level guarantee is enforced by the compiler.
 */

describe("Result", () => {
  it("constructs and narrows both variants", () => {
    const success = ok(42);
    const failure = err("nope");

    expect(success.ok).toBe(true);
    expect(failure.ok).toBe(false);
    expect(isOk(success)).toBe(true);
    expect(isErr(success)).toBe(false);
    expect(isOk(failure)).toBe(false);
    expect(isErr(failure)).toBe(true);

    if (isOk(success)) expect(success.value).toBe(42);
    if (isErr(failure)) expect(failure.error).toBe("nope");
  });

  it("unwraps a success", () => {
    expect(unwrap(ok("value"))).toBe("value");
  });

  it("throws on a failure, naming the context and the error", () => {
    expect(() => unwrap(err("boom"), "conversion")).toThrow(/conversion failed: boom/);
    expect(() => unwrap(err("boom"))).toThrow(/unwrap failed: boom/);
  });

  it("serialises a structured error when unwrapping fails", () => {
    expect(() => unwrap(err({ code: "EXTERNAL_VERIFICATION_REQUIRED" }), "adapter")).toThrow(
      /EXTERNAL_VERIFICATION_REQUIRED/,
    );
  });

  it("maps over a success and passes a failure through untouched", () => {
    const doubled = mapOk(ok(21), (value) => value * 2);
    expect(isOk(doubled) && doubled.value).toBe(42);

    const failure = err("nope");
    const mapped = mapOk(failure, () => {
      throw new Error("must not run");
    });
    expect(mapped).toBe(failure);
  });
});

describe("branded scalars", () => {
  it("constructs each brand without altering the underlying value", () => {
    expect(countsPer360(9448.82)).toBe(9448.82);
    expect(cmPer360(31.2)).toBe(31.2);
    expect(dpi(800)).toBe(800);
    expect(degrees(45)).toBe(45);
    expect(centimetres(22)).toBe(22);
    expect(logSensitivity(13.2)).toBe(13.2);
  });

  it("keeps brands usable in ordinary arithmetic", () => {
    // The brand is a compile-time guard only; it must cost nothing at runtime.
    const counts = countsPer360(1000);
    expect(counts * 2).toBe(2000);
    expect(Number.isFinite(counts)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { clientAddressFrom } from "@/lib/client-address";

/**
 * The trust boundary on `X-Forwarded-For` (`SENS-SEC-011`).
 *
 * These are the rate limiter's teeth. If the caller can choose the address then the per-IP
 * buckets on registration, sign-in and password reset are decoration: an attacker sends a
 * different value on each request and never meets a limit.
 */

describe("reading the client address behind a proxy", () => {
  it("takes the entry the trusted proxy wrote, not the one the client sent", () => {
    // The client forged the first entry; the proxy appended the address it actually saw.
    expect(clientAddressFrom("203.0.113.9, 198.51.100.4", 1)).toBe("198.51.100.4");
  });

  it("counts from the right for a longer trusted chain", () => {
    expect(clientAddressFrom("203.0.113.9, 198.51.100.4, 198.51.100.5", 2)).toBe("198.51.100.4");
  });

  it("ignores the header entirely when nothing in front is trusted", () => {
    // Directly exposed: every entry is client-written, so none of it is evidence. Returning
    // nothing is right — a shared bucket is a known limitation, a forged one is a hole.
    expect(clientAddressFrom("203.0.113.9, 198.51.100.4", 0)).toBeUndefined();
  });

  it("falls back to the furthest upstream entry when configured for more hops than arrived", () => {
    // A misconfiguration must fail towards the leftmost value, never towards one the client
    // could have appended.
    expect(clientAddressFrom("203.0.113.9, 198.51.100.4", 5)).toBe("203.0.113.9");
  });

  it("treats a missing, empty or separator-only header as no address", () => {
    expect(clientAddressFrom(null, 1)).toBeUndefined();
    expect(clientAddressFrom("", 1)).toBeUndefined();
    expect(clientAddressFrom("  ,   ,", 1)).toBeUndefined();
  });

  it("trims whitespace around the entry it returns", () => {
    expect(clientAddressFrom("203.0.113.9,   198.51.100.4   ", 1)).toBe("198.51.100.4");
  });

  it("never returns an entry the client could have supplied", () => {
    // The property behind every case above: with one trusted hop, whatever the caller writes
    // ends up to the left of the proxy's entry and must not be what comes back.
    const forged = "1.2.3.4";
    for (const chain of [forged, `${forged}, ${forged}`, `${forged}, 198.51.100.4`]) {
      const seen = clientAddressFrom(`${chain}, 198.51.100.7`, 1);
      expect(seen).toBe("198.51.100.7");
    }
  });
});

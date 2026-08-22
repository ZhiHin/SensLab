import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cmPer360FromCounts, countsPer360FromCm } from "@/core/sensitivity/canonical";
import {
  AdapterConstructionError,
  AdapterRegistry,
  MEASUREMENT_TOLERANCE_PCT,
  STALENESS_WINDOW_DAYS,
  VERIFICATION_REGISTER,
  VerificationOverlayError,
  authorisesConstants,
  createVerifiedAdapter,
  evaluateRecheck,
  findRegisterEntry,
  isDowngrade,
  isStale,
  openRegisterEntries,
  realRegisterEntries,
  summariseRegister,
  withVerificationOverlay,
  type VerificationEvidence,
  type VerifiedScopeSpec,
} from "@/game-adapters";
import { createFixtureAdapter, FIXTURE_YAW_DEG_PER_COUNT } from "@tests/helpers/fixture-adapter";

/**
 * The verification machinery — doc 36, doc 12 §12.6, doc 08 §8.6.
 *
 * This is the part of Phase 5 that does the actual work. Everything else converts numbers;
 * this decides whether there is a number to convert.
 */

const IDENTITY = {
  gameId: "construction-test",
  gameVersionLabel: "1.0",
  adapterVersion: "1.0.0",
  displayName: { en: "Construction Test" },
  region: "global" as const,
};

const measurement = (settingValue: number, cm: number) => ({
  scopeKey: "hipfire" as const,
  settingValue,
  dpi: 800,
  measuredCmPer360: cm,
  method: "fictional",
});

const cmFor = (settingValue: number): number =>
  cmPer360FromCounts(360 / (settingValue * FIXTURE_YAW_DEG_PER_COUNT), 800);

const EVIDENCE: VerificationEvidence = {
  verifiedAt: "2026-01-01T00:00:00.000Z",
  verifiedAgainstBuild: "build-1",
  sourceRefs: ["fixture://verification.test.ts"],
  signedOffBy: ["a", "b"],
  measurements: [measurement(0.5, cmFor(0.5)), measurement(6, cmFor(6))],
};

const scopeSpec = (overrides: Partial<VerifiedScopeSpec> = {}): VerifiedScopeSpec => ({
  scopeKey: "hipfire",
  displayName: { en: "Hipfire" },
  settingLabel: { en: "Sensitivity" },
  settingKey: "sensitivity",
  model: { form: "linear_yaw", yawDegPerCountAtSettingOne: FIXTURE_YAW_DEG_PER_COUNT },
  settingRange: { min: 0.1, max: 10, step: 0.01, decimals: 2 },
  adsModel: "raw_multiplier",
  verification: { status: "verified", evidence: EVIDENCE, registerEntry: "EV-FIXTURE" },
  ...overrides,
});

/* ------------------------------------------------------------------ the register */

describe("the register in code and the register in doc 36", () => {
  const document = readFileSync("docs/phase-0/36-external-verification-register.md", "utf8");

  it("carries every entry the document declares", () => {
    const documented = [...document.matchAll(/### (EV-\d{3}) —/g)].map((match) => match[1]);
    const inCode = realRegisterEntries().map((entry) => entry.id);
    expect([...new Set(documented)].sort()).toEqual([...inCode].sort());
  });

  it("agrees with the document that nothing real is verified yet", () => {
    // doc 36 §36.6 ends with this line. If a register entry closes, that line changes and so
    // does this assertion — deliberately, because closing an entry is a reviewed event.
    expect(document).toContain("**15 open items. 0 verified. 0 rejected.**");
    const summary = summariseRegister();
    expect(summary).toEqual({ total: 15, open: 15, verified: 0, rejected: 0 });
  });

  it("keeps fixture entries out of every count the product reports", () => {
    const fixtures = VERIFICATION_REGISTER.filter((entry) => entry.governs === "test_fixture");
    expect(fixtures.length).toBeGreaterThan(0);
    expect(openRegisterEntries().some((entry) => entry.governs === "test_fixture")).toBe(false);
    expect(realRegisterEntries().some((entry) => entry.governs === "test_fixture")).toBe(false);
  });

  it("authorises constants only for a closed entry", () => {
    expect(authorisesConstants("EV-001")).toBe(false);
    expect(authorisesConstants("EV-FIXTURE")).toBe(true);
    expect(authorisesConstants("EV-NONSENSE")).toBe(false);
    expect(findRegisterEntry("EV-NONSENSE")).toBeNull();
  });
});

/* ------------------------------------------------------------------ construction checks */

describe("what createVerifiedAdapter refuses to build", () => {
  it("builds when the evidence supports the model", () => {
    expect(() =>
      createVerifiedAdapter({ identity: IDENTITY, scopes: [scopeSpec()] }),
    ).not.toThrow();
  });

  it("refuses a scope whose register entry is still open", () => {
    // This is the check that makes shipping a constant impossible without the reviewed
    // moment that authorises it (`SENS-SEC-023`).
    expect(() =>
      createVerifiedAdapter({
        identity: IDENTITY,
        scopes: [
          scopeSpec({
            verification: { status: "verified", evidence: EVIDENCE, registerEntry: "EV-001" },
          }),
        ],
      }),
    ).toThrow(/register entry "EV-001" is not closed/);
  });

  it("refuses a scope citing a register entry that does not exist", () => {
    expect(() =>
      createVerifiedAdapter({
        identity: IDENTITY,
        scopes: [
          scopeSpec({
            verification: { status: "verified", evidence: EVIDENCE, registerEntry: "EV-MADE-UP" },
          }),
        ],
      }),
    ).toThrow(/does not exist/);
  });

  it("refuses a single measurement, which cannot test a model form", () => {
    expect(() =>
      createVerifiedAdapter({
        identity: IDENTITY,
        scopes: [
          scopeSpec({
            verification: {
              status: "verified",
              registerEntry: "EV-FIXTURE",
              evidence: { ...EVIDENCE, measurements: [measurement(0.5, cmFor(0.5))] },
            },
          }),
        ],
      }),
    ).toThrow(/two widely separated points are required/);
  });

  it("refuses two readings taken at the same setting", () => {
    expect(() =>
      createVerifiedAdapter({
        identity: IDENTITY,
        scopes: [
          scopeSpec({
            verification: {
              status: "verified",
              registerEntry: "EV-FIXTURE",
              evidence: {
                ...EVIDENCE,
                measurements: [measurement(0.5, cmFor(0.5)), measurement(0.5, cmFor(0.5))],
              },
            },
          }),
        ],
      }),
    ).toThrow(/distinct measured setting/);
  });

  it("refuses a model that does not reproduce its own measurements", () => {
    // The single most valuable check in the phase: a uniformly wrong constant passes every
    // round-trip, boundary and quantisation test while being wrong at every point.
    const wrongByTenPercent = {
      form: "linear_yaw" as const,
      yawDegPerCountAtSettingOne: FIXTURE_YAW_DEG_PER_COUNT * 1.1,
    };
    expect(() =>
      createVerifiedAdapter({
        identity: IDENTITY,
        scopes: [scopeSpec({ model: wrongByTenPercent })],
      }),
    ).toThrow(AdapterConstructionError);

    expect(() =>
      createVerifiedAdapter({
        identity: IDENTITY,
        scopes: [scopeSpec({ model: wrongByTenPercent })],
      }),
    ).toThrow(/The model form is wrong/);
  });

  it("accepts a residual inside the acceptance tolerance", () => {
    // doc 08 §8.5 step 7 sets ±0.5%; a real campaign will not land on the model exactly.
    const slightlyOff = {
      form: "linear_yaw" as const,
      yawDegPerCountAtSettingOne: FIXTURE_YAW_DEG_PER_COUNT * 1.004,
    };
    expect(MEASUREMENT_TOLERANCE_PCT).toBe(0.5);
    expect(() =>
      createVerifiedAdapter({ identity: IDENTITY, scopes: [scopeSpec({ model: slightlyOff })] }),
    ).not.toThrow();
  });

  it("does not require measurements from a scope that claims nothing", () => {
    const adapter = createVerifiedAdapter({
      identity: IDENTITY,
      scopes: [
        scopeSpec(),
        scopeSpec({
          scopeKey: "ads",
          settingKey: "ads_sensitivity",
          verification: { status: "unverified", registerEntry: "EV-FIXTURE-ADS" },
        }),
      ],
    });
    expect(adapter.verificationStatus()).toBe("partial");
  });
});

/* ------------------------------------------------------------------ staleness */

describe("re-verification triggers (doc 08 §8.6)", () => {
  const verifiedAt = "2026-01-01T00:00:00.000Z";

  it("treats a measurement older than the window as stale", () => {
    expect(STALENESS_WINDOW_DAYS).toBe(183);
    expect(isStale(verifiedAt, new Date("2026-03-01T00:00:00.000Z"))).toBe(false);
    expect(isStale(verifiedAt, new Date("2026-08-01T00:00:00.000Z"))).toBe(true);
  });

  it("rejects an unparseable instant rather than treating it as fresh", () => {
    expect(() => isStale("whenever", new Date())).toThrow(RangeError);
  });

  it("downgrades a stale scope to needs_recheck, not to unverified", () => {
    const adapter = createFixtureAdapter();
    const overlay = evaluateRecheck(adapter, { now: new Date("2026-09-01T00:00:00.000Z") });
    expect(overlay).not.toBeNull();
    expect(overlay?.statusByScope.get("hipfire")).toBe("needs_recheck");
    expect(overlay?.triggers).toContain("staleness");
  });

  it("leaves a fresh adapter alone", () => {
    const adapter = createFixtureAdapter();
    expect(evaluateRecheck(adapter, { now: new Date("2026-02-01T00:00:00.000Z") })).toBeNull();
  });

  it("drops straight to unverified on a confirmed mismatch", () => {
    // The number is not merely due for review; it is wrong now.
    const adapter = createFixtureAdapter();
    const overlay = evaluateRecheck(adapter, {
      now: new Date("2026-02-01T00:00:00.000Z"),
      triggers: ["confirmed_mismatch"],
    });
    expect(overlay?.statusByScope.get("hipfire")).toBe("unverified");
  });

  it("treats a game update as build-wide", () => {
    const adapter = createFixtureAdapter({ verifiedAdsScope: true });
    const overlay = evaluateRecheck(adapter, {
      now: new Date("2026-02-01T00:00:00.000Z"),
      triggers: ["game_update"],
    });
    expect(overlay?.statusByScope.get("hipfire")).toBe("needs_recheck");
    expect(overlay?.statusByScope.get("ads")).toBe("needs_recheck");
  });

  it("never touches a scope that was already unverified", () => {
    const adapter = createFixtureAdapter();
    const overlay = evaluateRecheck(adapter, {
      now: new Date("2027-01-01T00:00:00.000Z"),
      triggers: ["game_update"],
    });
    expect(overlay?.statusByScope.has("ads")).toBe(false);
  });
});

/* ------------------------------------------------------------------ the overlay */

describe("applying a downgrade", () => {
  const counts = countsPer360FromCm(31.2, 800);
  const context = { dpi: 800, scopeKey: "hipfire" as const };

  it("keeps serving values while flagged for re-check, with the disclosure attached", () => {
    const adapter = createFixtureAdapter();
    const overlay = evaluateRecheck(adapter, { now: new Date("2026-09-01T00:00:00.000Z") });
    expect(overlay).not.toBeNull();
    if (overlay === null) return;

    const downgraded = withVerificationOverlay(adapter, overlay);
    const outcome = downgraded.fromCanonical(counts, context);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.verification).toBe("needs_recheck");
      expect(outcome.value.lastVerifiedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(outcome.value.settings[0]?.value).toBeGreaterThan(0);
    }
  });

  it("stops serving values entirely on a confirmed mismatch", () => {
    const adapter = createFixtureAdapter();
    const overlay = evaluateRecheck(adapter, {
      now: new Date("2026-02-01T00:00:00.000Z"),
      triggers: ["confirmed_mismatch"],
    });
    expect(overlay).not.toBeNull();
    if (overlay === null) return;

    const downgraded = withVerificationOverlay(adapter, overlay);
    expect(downgraded.verificationStatus()).toBe("unverified");
    expect(downgraded.fromCanonical(counts, context).ok).toBe(false);
    expect(downgraded.toCanonical(1.5, context).ok).toBe(false);
    expect(downgraded.validate(1.5, "hipfire").valid).toBe(false);
  });

  it("drops the evidence when it drops the status, so the two cannot contradict", () => {
    const adapter = createFixtureAdapter();
    const overlay = evaluateRecheck(adapter, {
      now: new Date("2026-02-01T00:00:00.000Z"),
      triggers: ["confirmed_mismatch"],
    });
    if (overlay === null) return;
    const downgraded = withVerificationOverlay(adapter, overlay);
    expect(downgraded.scopeVerification("hipfire")?.evidence).toBeUndefined();

    // And the result is registrable, which is the real test: an unverified scope carrying
    // evidence is rejected by the registry.
    const registry = new AdapterRegistry();
    expect(() => registry.register(downgraded, { isCurrent: true })).not.toThrow();
  });

  it("refuses to upgrade", () => {
    // Re-verification produces a new adapter version (doc 12 §12.7). An overlay that could
    // raise a status would be a way to grant verification without evidence.
    const adapter = createFixtureAdapter();
    expect(isDowngrade("unverified", "verified")).toBe(false);
    expect(isDowngrade("verified", "needs_recheck")).toBe(true);

    expect(() =>
      withVerificationOverlay(adapter, {
        statusByScope: new Map([["ads", "verified"]]),
        triggers: [],
        reason: "test",
        appliedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(VerificationOverlayError);
  });

  it("rolls the overlaid scope statuses up correctly", () => {
    const partly = createFixtureAdapter({ verifiedAdsScope: true });
    const stale = evaluateRecheck(partly, { now: new Date("2026-09-01T00:00:00.000Z") });
    expect(stale).not.toBeNull();
    if (stale === null) return;

    // Both scopes flagged: the adapter as a whole is due for re-check, not partial.
    expect(withVerificationOverlay(partly, stale).verificationStatus()).toBe("needs_recheck");

    // One scope withdrawn and one still verified is genuinely partial.
    const mixed = withVerificationOverlay(partly, {
      statusByScope: new Map([["ads", "unverified"]]),
      triggers: ["confirmed_mismatch"],
      reason: "one optic was wrong",
      appliedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(mixed.verificationStatus()).toBe("partial");
    expect(mixed.scopeVerification("hipfire")?.status).toBe("verified");
    expect(mixed.scopeVerification("x8")).toBeNull();

    // And a withdrawn scope reopens its register entry.
    expect(mixed.openRegisterEntries()).toContain("EV-FIXTURE");
  });

  it("passes conversions through untouched for a scope it did not downgrade", () => {
    const partly = createFixtureAdapter({ verifiedAdsScope: true });
    const mixed = withVerificationOverlay(partly, {
      statusByScope: new Map([["ads", "unverified"]]),
      triggers: ["confirmed_mismatch"],
      reason: "one optic was wrong",
      appliedAt: "2026-02-01T00:00:00.000Z",
    });

    const direct = partly.toCanonical(1.5, context);
    const throughOverlay = mixed.toCanonical(1.5, context);
    expect(throughOverlay.ok).toBe(true);
    if (direct.ok && throughOverlay.ok) {
      expect(throughOverlay.value.countsPer360).toBe(direct.value.countsPer360);
    }
    expect(mixed.validate(1.5, "hipfire").valid).toBe(true);
    expect(mixed.fromCanonical(counts, context).ok).toBe(true);

    // A scope the game never offered is still unsupported, not withdrawn.
    const unsupported = mixed.fromCanonical(counts, { dpi: 800, scopeKey: "x8" });
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) expect(unsupported.error.code).toBe("UNSUPPORTED_SCOPE");
  });

  it("leaves the original adapter untouched", () => {
    // Released parameter sets are immutable (`SENS-BR-029`); the overlay is a new object.
    const adapter = createFixtureAdapter();
    const overlay = evaluateRecheck(adapter, {
      now: new Date("2026-02-01T00:00:00.000Z"),
      triggers: ["confirmed_mismatch"],
    });
    if (overlay === null) return;
    withVerificationOverlay(adapter, overlay);
    expect(adapter.verificationStatus()).toBe("partial");
    expect(adapter.fromCanonical(counts, context).ok).toBe(true);
  });
});

describe("the registry applies re-checks in place", () => {
  it("replaces the registration, so no caller can resolve the original", () => {
    const registry = new AdapterRegistry();
    const adapter = createFixtureAdapter();
    registry.register(adapter, { isCurrent: true });

    const changed = registry.runRecheck({ now: new Date("2026-09-01T00:00:00.000Z") });
    expect(changed).toHaveLength(1);
    expect(changed[0]?.status).toBe("partial");
    expect(changed[0]?.recheckReason).toContain("re-verification is due");

    const resolved = registry.resolve("fixture-game");
    expect(resolved).not.toBe(adapter);
    expect(resolved?.scopeVerification("hipfire")?.status).toBe("needs_recheck");
  });

  it("reports nothing when nothing is due", () => {
    const registry = new AdapterRegistry();
    registry.register(createFixtureAdapter(), { isCurrent: true });
    expect(registry.runRecheck({ now: new Date("2026-02-01T00:00:00.000Z") })).toHaveLength(0);
  });

  it("accepts per-game triggers", () => {
    const registry = new AdapterRegistry();
    registry.register(createFixtureAdapter({ gameId: "one" }), { isCurrent: true });
    registry.register(createFixtureAdapter({ gameId: "two" }), { isCurrent: true });

    const changed = registry.runRecheck({
      now: new Date("2026-02-01T00:00:00.000Z"),
      triggersByGame: new Map([["one", ["confirmed_mismatch"]]]),
    });
    expect(changed.map((summary) => summary.gameId)).toEqual(["one"]);
    expect(registry.resolve("two")?.scopeVerification("hipfire")?.status).toBe("verified");
  });

  it("refuses an overlay for an adapter that is not registered", () => {
    const registry = new AdapterRegistry();
    expect(() =>
      registry.applyOverlay("nope", "1.0", {
        statusByScope: new Map(),
        triggers: [],
        reason: "test",
        appliedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/not registered/);
  });
});

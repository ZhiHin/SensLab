import { describe, expect, it } from "vitest";
import {
  AdapterRegistrationError,
  AdapterRegistry,
  LAUNCH_ADAPTERS,
  createLaunchRegistry,
  createUnverifiedAdapter,
  gameAdapterRegistry,
} from "@/game-adapters";
import { countsPer360FromCm } from "@/core/sensitivity/canonical";
import { createFixtureAdapter } from "@tests/helpers/fixture-adapter";

describe("AdapterRegistry", () => {
  it("resolves a registered adapter by id and by explicit version", () => {
    const registry = new AdapterRegistry();
    const adapter = createFixtureAdapter({ gameVersionLabel: "1.0" });
    registry.register(adapter, { isCurrent: true });

    expect(registry.resolve("fixture-game")).toBe(adapter);
    expect(registry.resolve("fixture-game", "1.0")).toBe(adapter);
    expect(registry.has("fixture-game")).toBe(true);
    expect(registry.size).toBe(1);
  });

  it("returns null for an unknown game or version rather than throwing", () => {
    const registry = new AdapterRegistry();
    expect(registry.resolve("nope")).toBeNull();
    expect(registry.has("nope")).toBe(false);

    registry.register(createFixtureAdapter({ gameVersionLabel: "1.0" }), { isCurrent: true });
    expect(registry.resolve("fixture-game", "2.0")).toBeNull();
  });

  it("keeps historical versions resolvable alongside the current one", () => {
    // A recommendation pins the adapter version that produced it; re-rendering an old
    // result must use that adapter, not today's.
    const registry = new AdapterRegistry();
    const old = createFixtureAdapter({ gameVersionLabel: "1.0", adapterVersion: "1.0.0" });
    const current = createFixtureAdapter({ gameVersionLabel: "2.0", adapterVersion: "2.0.0" });
    registry.register(old, { isCurrent: false });
    registry.register(current, { isCurrent: true });

    expect(registry.resolve("fixture-game")).toBe(current);
    expect(registry.resolve("fixture-game", "1.0")).toBe(old);
    expect(registry.list()).toHaveLength(2);
    expect(registry.listCurrent()).toHaveLength(1);
  });

  it("rejects duplicate registrations", () => {
    const registry = new AdapterRegistry();
    registry.register(createFixtureAdapter(), { isCurrent: true });
    expect(() => registry.register(createFixtureAdapter(), { isCurrent: false })).toThrow(
      AdapterRegistrationError,
    );
  });

  it("allows only one current version per game", () => {
    const registry = new AdapterRegistry();
    registry.register(createFixtureAdapter({ gameVersionLabel: "1.0" }), { isCurrent: true });
    expect(() =>
      registry.register(createFixtureAdapter({ gameVersionLabel: "2.0" }), { isCurrent: true }),
    ).toThrow(/already has a current version/);
  });

  it("refuses to register a scope that claims verification without evidence", () => {
    const registry = new AdapterRegistry();
    const dishonest = createFixtureAdapter();
    const tampered = {
      ...dishonest,
      scopes: dishonest.scopes.map((scope) =>
        scope.scopeKey === "hipfire"
          ? { ...scope, verification: { status: "verified" as const, registerEntry: "EV-FIXTURE" } }
          : scope,
      ),
    };
    expect(() => registry.register(tampered, { isCurrent: true })).toThrow(
      /without verification evidence/,
    );
  });

  it("refuses to register a scope citing an entry that is not in the register", () => {
    // Since Phase 5 the register in code is the authority. A scope may not cite an entry
    // that does not exist, and may not claim more than the entry it cites (`SENS-SEC-023`).
    const registry = new AdapterRegistry();
    const base = createFixtureAdapter();
    const invented = {
      ...base,
      scopes: base.scopes.map((scope) =>
        scope.scopeKey === "hipfire"
          ? { ...scope, verification: { ...scope.verification, registerEntry: "EV-X" } }
          : scope,
      ),
    };
    expect(() => registry.register(invented, { isCurrent: true })).toThrow(
      /not in the verification register/,
    );
  });

  it("refuses to register a scope whose register entry is still open", () => {
    const registry = new AdapterRegistry();
    const base = createFixtureAdapter();
    const overclaiming = {
      ...base,
      scopes: base.scopes.map((scope) =>
        scope.scopeKey === "hipfire"
          ? { ...scope, verification: { ...scope.verification, registerEntry: "EV-001" } }
          : scope,
      ),
    };
    expect(() => registry.register(overclaiming, { isCurrent: true })).toThrow(/is still open/);
  });

  it("refuses to register a scope marked unverified that nonetheless carries evidence", () => {
    const registry = new AdapterRegistry();
    const base = createFixtureAdapter();
    const contradictory = {
      ...base,
      scopes: base.scopes.map((scope) =>
        scope.scopeKey === "ads"
          ? {
              ...scope,
              verification: {
                status: "unverified" as const,
                registerEntry: "EV-FIXTURE-ADS",
                evidence: {
                  verifiedAt: "2026-01-01T00:00:00.000Z",
                  verifiedAgainstBuild: "b",
                  sourceRefs: [],
                  signedOffBy: ["a", "b"] as [string, string],
                  measurements: [],
                },
              },
            }
          : scope,
      ),
    };
    expect(() => registry.register(contradictory, { isCurrent: true })).toThrow(
      /marked unverified but carries evidence/,
    );
  });

  it("summarises adapters with their outstanding register entries", () => {
    const registry = new AdapterRegistry();
    registry.register(createFixtureAdapter(), { isCurrent: true });
    const summary = registry.list()[0];
    expect(summary?.status).toBe("partial");
    expect(summary?.openRegisterEntries).toEqual(["EV-FIXTURE-ADS"]);
    expect(summary?.isCurrent).toBe(true);
  });

  it("sorts listings deterministically", () => {
    const registry = new AdapterRegistry();
    registry.register(createFixtureAdapter({ gameId: "zeta" }), { isCurrent: true });
    registry.register(createFixtureAdapter({ gameId: "alpha" }), { isCurrent: true });
    expect(registry.list().map((s) => s.gameId)).toEqual(["alpha", "zeta"]);
  });
});

describe("launch roster", () => {
  it("registers all five launch games", () => {
    const registry = createLaunchRegistry();
    expect(registry.size).toBe(5);
    for (const gameId of ["cs2", "apex-legends", "pubg", "delta-force-global", "delta-force-cn"]) {
      expect(registry.resolve(gameId)).not.toBeNull();
    }
  });

  it("treats Delta Force Global and 三角洲行动 as separate games — SENS-BR-015", () => {
    const registry = createLaunchRegistry();
    const global = registry.resolve("delta-force-global");
    const china = registry.resolve("delta-force-cn");

    expect(global).not.toBeNull();
    expect(china).not.toBeNull();
    expect(global).not.toBe(china);
    expect(global?.identity.region).toBe("global");
    expect(china?.identity.region).toBe("cn");
    // Independent register entries: closing one must not close the other.
    expect(global?.scopeVerification("hipfire")).toBeNull();
  });

  it("carries a Simplified Chinese display name for the China build", () => {
    const china = createLaunchRegistry().resolve("delta-force-cn");
    expect(china?.identity.displayName["zh-Hans"]).toBe("三角洲行动");
  });

  it("has every launch adapter unverified at Phase 1 — doc 36 records zero verified items", () => {
    for (const adapter of LAUNCH_ADAPTERS) {
      expect(adapter.verificationStatus()).toBe("unverified");
    }
    expect(gameAdapterRegistry.listCurrent().every((s) => s.status === "unverified")).toBe(true);
  });
});

describe("the verification gate — SENS-BR-013 / SENS-BR-014", () => {
  const context = { dpi: 800, scopeKey: "hipfire" as const };
  const counts = countsPer360FromCm(31.2, 800);

  it("refuses to convert for every unverified launch adapter", () => {
    for (const adapter of LAUNCH_ADAPTERS) {
      const outcome = adapter.fromCanonical(counts, context);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe("EXTERNAL_VERIFICATION_REQUIRED");
        expect(outcome.error.registerEntry).toMatch(/^EV-\d{3}$/);
      }
    }
  });

  it("refuses the inverse direction too, so nothing can be back-solved", () => {
    for (const adapter of LAUNCH_ADAPTERS) {
      const outcome = adapter.toCanonical(2.0, context);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.code).toBe("EXTERNAL_VERIFICATION_REQUIRED");
    }
  });

  it("returns no numeric value anywhere in the failure payload", () => {
    // A failure must not leak an approximation the UI could accidentally render.
    const outcome = LAUNCH_ADAPTERS[0]?.fromCanonical(counts, context);
    expect(outcome?.ok).toBe(false);
    if (outcome !== undefined && !outcome.ok) {
      const serialised = JSON.stringify(outcome.error);
      expect(serialised).not.toMatch(/\d+\.\d+/);
    }
  });

  it("refuses to validate a setting against a range it has not measured", () => {
    for (const adapter of LAUNCH_ADAPTERS) {
      const validation = adapter.validate(2.0, "hipfire");
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe("unverified");
      expect(validation.range).toBeUndefined();
    }
  });

  it("names the open register entry so the UI can say what is outstanding", () => {
    const cs2 = createLaunchRegistry().resolve("cs2");
    const outcome = cs2?.fromCanonical(counts, context);
    expect(outcome?.ok).toBe(false);
    if (outcome !== undefined && !outcome.ok) {
      expect(outcome.error.registerEntry).toBe("EV-001");
      expect(outcome.error.gameId).toBe("cs2");
      expect(outcome.error.gameVersionLabel).toBe("pre-verification");
    }
  });

  it("reports anticipated scopes as unverified rather than pretending they do not exist", () => {
    const adapter = createUnverifiedAdapter({
      identity: {
        gameId: "example",
        gameVersionLabel: "x",
        adapterVersion: "0.1.0",
        displayName: { en: "Example" },
        region: "global",
      },
      registerEntry: "EV-999",
      anticipatedScopes: ["hipfire", "ads"],
    });
    expect(adapter.scopes).toHaveLength(2);
    expect(adapter.scopeVerification("hipfire")?.status).toBe("unverified");
    expect(adapter.scopeVerification("x8")).toBeNull();
    // Declared scopes still carry no model form or range — we have not measured them.
    expect(adapter.scopes.every((scope) => scope.modelForm === null)).toBe(true);
    expect(adapter.scopes.every((scope) => scope.settingRange === null)).toBe(true);
  });
});

describe("the verification gate on a partially verified adapter", () => {
  const adapter = createFixtureAdapter();
  const counts = countsPer360FromCm(31.2, 800);

  it("converts for a verified scope", () => {
    const outcome = adapter.fromCanonical(counts, { dpi: 800, scopeKey: "hipfire" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.settings).toHaveLength(1);
      expect(outcome.value.settings[0]?.key).toBe("sensitivity");
      expect(outcome.value.verification).toBe("verified");
    }
  });

  it("refuses the unverified scope on the same adapter", () => {
    const outcome = adapter.fromCanonical(counts, { dpi: 800, scopeKey: "ads" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("EXTERNAL_VERIFICATION_REQUIRED");
  });

  it("reports a scope the game does not offer as unsupported, not unverified", () => {
    const outcome = adapter.fromCanonical(counts, { dpi: 800, scopeKey: "x8" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("UNSUPPORTED_SCOPE");
  });

  it("reports partial status when some scopes are verified and some are not", () => {
    expect(adapter.verificationStatus()).toBe("partial");
    expect(createFixtureAdapter({ includeUnverifiedAdsScope: false }).verificationStatus()).toBe(
      "verified",
    );
  });

  it("round-trips a verified conversion within one quantisation step", () => {
    const context = { dpi: 800, scopeKey: "hipfire" as const };
    for (const cm of [15, 22.4, 31.2, 48, 72]) {
      const target = countsPer360FromCm(cm, 800);
      const forward = adapter.fromCanonical(target, context);
      expect(forward.ok).toBe(true);
      if (!forward.ok) continue;
      const setting = forward.value.settings[0]?.value ?? 0;
      const back = adapter.toCanonical(setting, context);
      expect(back.ok).toBe(true);
      if (back.ok) {
        expect(back.value.countsPer360).toBeCloseTo(forward.value.achievedCountsPer360, 6);
      }
      expect(Math.abs(forward.value.quantisationErrorPct)).toBeLessThan(1);
    }
  });

  it("reports the achieved value rather than only the ideal one", () => {
    const outcome = adapter.fromCanonical(countsPer360FromCm(31.2, 800), {
      dpi: 800,
      scopeKey: "hipfire",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const setting = outcome.value.settings[0];
      expect(setting?.idealValue).not.toBe(setting?.value);
      expect(outcome.value.achievedCmPer360).toBeCloseTo(31.2, 1);
    }
  });

  it("clamps out-of-range requests and says so", () => {
    // An extremely fast sensitivity would need a setting beyond the game's maximum.
    const outcome = adapter.fromCanonical(countsPer360FromCm(0.5, 800), {
      dpi: 800,
      scopeKey: "hipfire",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.settings[0]?.clamped).toBe(true);
  });

  it("rejects an out-of-range game setting on the way in", () => {
    const outcome = adapter.toCanonical(99, { dpi: 800, scopeKey: "hipfire" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("SETTING_OUT_OF_RANGE");
  });

  it("validates settings against the declared range and step", () => {
    expect(adapter.validate(1.5, "hipfire").valid).toBe(true);
    expect(adapter.validate(0.001, "hipfire").reason).toBe("below_min");
    expect(adapter.validate(50, "hipfire").reason).toBe("above_max");
    expect(adapter.validate(1.005, "hipfire").reason).toBe("not_on_step");
    expect(adapter.validate(1.5, "ads").reason).toBe("unverified");
    expect(adapter.validate(1.5, "x4").reason).toBe("unsupported_scope");
  });
});

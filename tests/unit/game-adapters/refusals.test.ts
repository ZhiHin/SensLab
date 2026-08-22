import { describe, expect, it } from "vitest";
import { countsPer360FromCm } from "@/core/sensitivity/canonical";
import {
  createVerifiedAdapter,
  tableCountsBounds,
  type ScopeDefinition,
  type TableParams,
  type VerificationEvidence,
  type VerifiedScopeSpec,
} from "@/game-adapters";
import {
  FIXTURE_TABLE_ANCHORS,
  createFixtureAdapter,
  createTableFixtureAdapter,
} from "@tests/helpers/fixture-adapter";

/**
 * Every path by which a verified adapter declines to produce a number.
 *
 * These deserve their own file because they are where a wrong branch is most expensive: a
 * refusal that fell through to a value would put a number in front of a player that nothing
 * in the system supports. A refusal that fires when it should not is merely annoying; the
 * other direction is the failure this product exists to prevent.
 */

const TABLE = createTableFixtureAdapter();
const LINEAR = createFixtureAdapter();
const context = { dpi: 800, scopeKey: "hipfire" as const };

describe("refusals on the way in", () => {
  it("rejects a setting below the declared minimum", () => {
    const outcome = LINEAR.toCanonical(0.05, context);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("SETTING_OUT_OF_RANGE");
  });

  it("rejects a setting above the declared maximum", () => {
    const outcome = LINEAR.toCanonical(50, context);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("SETTING_OUT_OF_RANGE");
  });

  it("rejects a setting inside the range but outside what was measured", () => {
    // A table model's declared range can legitimately be narrower than the game's, and the
    // gap between them is territory with no measurement in it.
    const narrow = createVerifiedAdapter({
      identity: {
        gameId: "narrow-table",
        gameVersionLabel: "1.0",
        adapterVersion: "1.0.0",
        displayName: { en: "Narrow" },
        region: "global",
      },
      scopes: [
        {
          ...(TABLE.scopes[0] as unknown as VerifiedScopeSpec),
          settingKey: "sensitivity",
          // Wider than the anchors, which stop at 100.
          settingRange: { min: 1, max: 200, step: 1, decimals: 0 },
          model: TABLE.scopes[0]?.model as TableParams,
        },
      ],
    });

    const outcome = narrow.toCanonical(150, { dpi: 800, scopeKey: "hipfire" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("OUTSIDE_MEASURED_RANGE");
  });
});

describe("refusals on the way out", () => {
  it("rejects a canonical value that is not a positive number", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const outcome = LINEAR.fromCanonical(bad, context);
      expect(outcome.ok, `counts=${bad}`).toBe(false);
      if (!outcome.ok) expect(outcome.error.code).toBe("MISSING_CONTEXT");
    }
  });

  it("refuses a target outside the measured range rather than extrapolating", () => {
    const bounds = tableCountsBounds(TABLE.scopes[0]?.model as TableParams);
    const outcome = TABLE.fromCanonical(bounds.max * 1.5, context);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("OUTSIDE_MEASURED_RANGE");
      expect(outcome.error.detail).toContain("measured range");
    }
  });

  it("clamps rather than refuses when the target is merely outside the setting range", () => {
    // The distinction matters: "your game cannot go that slow" is a fact the user can act on
    // by changing DPI, whereas "we never measured that far" is a gap in our evidence.
    const outcome = LINEAR.fromCanonical(countsPer360FromCm(0.5, 800), context);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.settings[0]?.clamped).toBe(true);
  });
});

describe("a scope flagged for re-check keeps serving, with the disclosure", () => {
  // Constructed directly rather than through an overlay, so the adapter's own handling of a
  // needs_recheck scope is covered rather than the wrapper's.
  const adapter = createVerifiedAdapter({
    identity: {
      gameId: "recheck-fixture",
      gameVersionLabel: "1.0",
      adapterVersion: "1.0.0",
      displayName: { en: "Recheck Fixture" },
      region: "global",
    },
    scopes: [
      {
        ...(LINEAR.scopes[0] as unknown as VerifiedScopeSpec),
        settingKey: "sensitivity",
        verification: {
          status: "needs_recheck",
          registerEntry: "EV-FIXTURE",
          evidence: (LINEAR.scopes[0] as ScopeDefinition).verification
            .evidence as VerificationEvidence,
        },
      },
    ],
  });

  it("reports needs_recheck and when it was last verified", () => {
    expect(adapter.verificationStatus()).toBe("needs_recheck");
    const outcome = adapter.fromCanonical(countsPer360FromCm(31.2, 800), context);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.verification).toBe("needs_recheck");
      expect(outcome.value.lastVerifiedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(outcome.value.settings[0]?.value).toBeGreaterThan(0);
    }
  });

  it("still counts as outstanding verification work", () => {
    expect(adapter.openRegisterEntries()).toContain("EV-FIXTURE");
  });
});

describe("an adapter with no scopes at all", () => {
  it("reports unverified rather than claiming completeness", () => {
    // Vacuous truth is the trap: "every scope is verified" is true of an empty list.
    const empty = createVerifiedAdapter({
      identity: {
        gameId: "empty-fixture",
        gameVersionLabel: "1.0",
        adapterVersion: "1.0.0",
        displayName: { en: "Empty" },
        region: "global",
      },
      scopes: [],
      openRegisterEntries: ["EV-FIXTURE-ADS"],
    });
    expect(empty.verificationStatus()).toBe("unverified");
    expect(empty.openRegisterEntries()).toEqual(["EV-FIXTURE-ADS"]);
    expect(empty.fromCanonical(countsPer360FromCm(31.2, 800), context).ok).toBe(false);
  });
});

describe("the table fixture anchors are what the adapter actually uses", () => {
  it("declares the same anchors the helper exports", () => {
    const model = TABLE.scopes[0]?.model as TableParams;
    expect(model.anchors).toEqual(FIXTURE_TABLE_ANCHORS);
  });
});

import { describe, expect, it } from "vitest";
import { deriveRng } from "@/core/random";
import { cmPer360FromCounts, countsPer360FromCm } from "@/core/sensitivity/canonical";
import { DEFAULT_SENSITIVITY_DOMAIN } from "@/core/sensitivity/domain";
import type { ScopeKey } from "@/core/types/vocabulary";
import {
  MEASUREMENT_TOLERANCE_PCT,
  MIN_ANCHORS,
  measurementCounts,
  type GameAdapter,
  type ScopeDefinition,
} from "@/game-adapters";

/**
 * The adapter conformance suite — doc 12 §12.8, all eight classes.
 *
 * Written once and run over **every** registered adapter, so a newly added game is covered
 * the moment it is registered rather than when someone remembers to write its tests. Doc 12
 * §12.6 asks for exactly this for the verification gate; the same argument applies to the
 * other seven, and the cost of generalising them is one parameter.
 *
 * Requirement 6 (golden vectors) is the one doc 12 singles out as easy to skip and the only
 * one that compares the model against reality rather than against itself. Here it is not
 * skippable: an adapter cannot even be constructed without the measurements it replays.
 */

/**
 * Every test below drives one scope in isolation, so the canonical value it hands back to
 * `fromCanonical` is that scope's own target rather than a hipfire one — otherwise the
 * matching criterion would be applied a second time and the round trip would not be one.
 */
const SCOPE_BASIS = "scope" as const;

const SAMPLE_COUNT = 1000;
const DPI = 800;

function verifiedScopes(adapter: GameAdapter): readonly ScopeDefinition[] {
  return adapter.scopes.filter((scope) => scope.verification.status !== "unverified");
}

function settingSamples(scope: ScopeDefinition, seed: string): number[] {
  const range = scope.settingRange;
  if (range === null) return [];
  const rng = deriveRng(seed, "conformance-settings");
  const values: number[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    values.push(rng.nextRange(range.min, range.max));
  }
  return values;
}

export interface ConformanceOptions {
  /** Locales every declared label must carry. */
  readonly requiredLocales?: readonly string[];
}

export function runAdapterConformance(
  adapter: GameAdapter,
  options: ConformanceOptions = {},
): void {
  const label = `${adapter.identity.gameId}@${adapter.identity.gameVersionLabel}`;
  const scopes = verifiedScopes(adapter);

  describe(`adapter conformance — ${label}`, () => {
    /* ---------------------------------------------- 5. the verification gate (every adapter) */

    it("refuses every unverified scope, in both directions", () => {
      const counts = countsPer360FromCm(31.2, DPI);
      for (const scope of adapter.scopes) {
        if (scope.verification.status !== "unverified") continue;
        const context = { dpi: DPI, scopeKey: scope.scopeKey };

        const forward = adapter.fromCanonical(counts, context);
        expect(forward.ok, `${scope.scopeKey} fromCanonical`).toBe(false);
        if (!forward.ok) {
          expect(forward.error.code).toBe("EXTERNAL_VERIFICATION_REQUIRED");
          expect(forward.error.registerEntry).toBe(scope.verification.registerEntry);
        }

        const inverse = adapter.toCanonical(1, context);
        expect(inverse.ok, `${scope.scopeKey} toCanonical`).toBe(false);

        expect(adapter.validate(1, scope.scopeKey).valid).toBe(false);
      }
    });

    it("reports a scope the game does not offer as unsupported rather than unverified", () => {
      // An adapter with no declared scopes has not established what the game offers, so
      // "this game does not have that scope" is a claim it cannot make. It answers
      // EXTERNAL_VERIFICATION_REQUIRED for everything, which is the honest answer.
      if (adapter.scopes.length === 0) return;
      const offered = new Set(adapter.scopes.map((scope) => scope.scopeKey));
      const missing = (["hipfire", "ads", "x1", "x2", "x3", "x4", "x6", "x8"] as ScopeKey[]).find(
        (scopeKey) => !offered.has(scopeKey),
      );
      if (missing === undefined) return;

      const outcome = adapter.fromCanonical(countsPer360FromCm(31.2, DPI), {
        dpi: DPI,
        scopeKey: missing,
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.code).toBe("UNSUPPORTED_SCOPE");
    });

    it("never leaks a number through a refusal", () => {
      // A failure payload the UI could accidentally render as a value is the one way an
      // unverified game still ends up showing one.
      for (const scope of adapter.scopes) {
        if (scope.verification.status !== "unverified") continue;
        const outcome = adapter.fromCanonical(countsPer360FromCm(31.2, DPI), {
          dpi: DPI,
          scopeKey: scope.scopeKey,
        });
        if (outcome.ok) continue;
        for (const value of Object.values(outcome.error)) {
          expect(typeof value).not.toBe("number");
        }
        // The prose must not carry one either: the detail string is the one field a surface
        // might render verbatim beside an empty value slot.
        expect(outcome.error.detail).not.toMatch(/\d+\.\d+/);
      }
    });

    /* ---------------------------------------------- 8. localised labels (every adapter) */

    it("declares an English label for every scope, and every required locale", () => {
      const locales = options.requiredLocales ?? ["en"];
      for (const scope of adapter.scopes) {
        for (const locale of locales) {
          expect(scope.displayName[locale], `${scope.scopeKey} displayName.${locale}`).toBeTruthy();
          expect(
            scope.settingLabel[locale],
            `${scope.scopeKey} settingLabel.${locale}`,
          ).toBeTruthy();
        }
      }
    });

    if (scopes.length === 0) return;

    /* ---------------------------------------------- 1. setting round-trip */

    it("round-trips settings through canonical and back, within one quantisation step", () => {
      for (const scope of scopes) {
        const range = scope.settingRange;
        if (range === null) continue;
        const context = { dpi: DPI, scopeKey: scope.scopeKey, canonicalBasis: SCOPE_BASIS };

        for (const settingValue of settingSamples(scope, `${label}:${scope.scopeKey}`)) {
          const canonical = adapter.toCanonical(settingValue, context);
          expect(canonical.ok).toBe(true);
          if (!canonical.ok) continue;

          // Round-tripping a scope means feeding back that scope's own target, not a
          // hipfire one — otherwise the criterion would be applied a second time.
          const back = adapter.fromCanonical(canonical.value.countsPer360, context);
          expect(back.ok).toBe(true);
          if (!back.ok) continue;

          const returned = back.value.settings[0]?.value ?? NaN;
          expect(Math.abs(returned - settingValue)).toBeLessThanOrEqual(range.step * 1.0000001);
        }
      }
    });

    /* ---------------------------------------------- 2. canonical round-trip */

    it("reports an achieved value that its own inverse reproduces to 1e-9 relative", () => {
      // The achieved value is what the player will actually get. If `toCanonical` of the
      // emitted setting disagrees with it, one of the two is lying about the same number.
      for (const scope of scopes) {
        const context = { dpi: DPI, scopeKey: scope.scopeKey, canonicalBasis: SCOPE_BASIS };
        const rng = deriveRng(`${label}:${scope.scopeKey}`, "conformance-canonical");
        const bounds = {
          min: countsPer360FromCm(DEFAULT_SENSITIVITY_DOMAIN.minCmPer360, DPI),
          max: countsPer360FromCm(DEFAULT_SENSITIVITY_DOMAIN.maxCmPer360, DPI),
        };

        for (let i = 0; i < SAMPLE_COUNT; i += 1) {
          const requested = rng.nextRange(bounds.min, bounds.max);
          const forward = adapter.fromCanonical(requested, context);
          if (!forward.ok) continue;

          const setting = forward.value.settings[0]?.value ?? NaN;
          const back = adapter.toCanonical(setting, context);
          if (!back.ok) continue;

          const achieved = forward.value.achievedCountsPer360;
          expect(Math.abs(back.value.countsPer360 - achieved) / achieved).toBeLessThan(1e-9);
        }
      }
    });

    /* ---------------------------------------------- 3. boundaries */

    it("clamps beyond the declared range and says that it did", () => {
      for (const scope of scopes) {
        const range = scope.settingRange;
        if (range === null) continue;
        const context = { dpi: DPI, scopeKey: scope.scopeKey, canonicalBasis: SCOPE_BASIS };

        for (const settingValue of [range.min, range.max]) {
          const canonical = adapter.toCanonical(settingValue, context);
          expect(canonical.ok, `${scope.scopeKey} at ${settingValue}`).toBe(true);
          if (!canonical.ok) continue;
          // Round-tripping a scope means feeding back that scope's own target, not a
          // hipfire one — otherwise the criterion would be applied a second time.
          const back = adapter.fromCanonical(canonical.value.countsPer360, context);
          expect(back.ok).toBe(true);
          if (back.ok) expect(back.value.settings[0]?.clamped).toBe(false);
        }

        for (const beyond of [range.min - range.step, range.max + range.step]) {
          expect(adapter.toCanonical(beyond, context).ok).toBe(false);
        }
      }
    });

    /* ---------------------------------------------- 4. quantisation */

    it("recomputes the achieved value from the quantised setting, not the ideal one", () => {
      for (const scope of scopes) {
        const range = scope.settingRange;
        if (range === null) continue;
        const context = { dpi: DPI, scopeKey: scope.scopeKey, canonicalBasis: SCOPE_BASIS };
        const rng = deriveRng(`${label}:${scope.scopeKey}`, "conformance-quantisation");

        for (let i = 0; i < 200; i += 1) {
          const requested = countsPer360FromCm(rng.nextRange(12, 60), DPI);
          const outcome = adapter.fromCanonical(requested, context);
          if (!outcome.ok) continue;

          const emitted = outcome.value.settings[0];
          expect(emitted).toBeDefined();
          if (emitted === undefined) continue;

          // The emitted value sits on the game's own grid at its own precision.
          const steps = emitted.value / range.step;
          expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
          expect(emitted.value).toBe(Number(emitted.value.toFixed(range.decimals)));

          // And the reported error is the one implied by the achieved value.
          if (emitted.clamped) continue;
          const target = outcome.value.achievedCountsPer360;
          const implied = ((target - requested) / requested) * 100;
          expect(outcome.value.quantisationErrorPct).toBeCloseTo(implied, 9);
          expect(outcome.value.achievedCmPer360).toBeCloseTo(cmPer360FromCounts(target, DPI), 9);
        }
      }
    });

    /* ---------------------------------------------- 6. golden vectors */

    it("reproduces its own recorded measurements within the acceptance tolerance", () => {
      for (const scope of scopes) {
        const evidence = scope.verification.evidence;
        expect(evidence, `${scope.scopeKey} evidence`).toBeDefined();
        if (evidence === undefined) continue;

        const measurements = evidence.measurements.filter(
          (measurement) => measurement.scopeKey === scope.scopeKey,
        );
        expect(measurements.length, `${scope.scopeKey} measurement count`).toBeGreaterThanOrEqual(
          2,
        );

        for (const measurement of measurements) {
          const outcome = adapter.toCanonical(measurement.settingValue, {
            dpi: measurement.dpi,
            scopeKey: scope.scopeKey,
          });
          expect(outcome.ok, `${scope.scopeKey} @ ${measurement.settingValue}`).toBe(true);
          if (!outcome.ok) continue;

          const expected = measurementCounts(measurement);
          const residualPct = (Math.abs(outcome.value.countsPer360 - expected) / expected) * 100;
          expect(residualPct).toBeLessThanOrEqual(MEASUREMENT_TOLERANCE_PCT);
        }
      }
    });

    /* ---------------------------------------------- 7. table form */

    it("keeps table anchors monotone and sufficiently numerous", () => {
      for (const scope of scopes) {
        const model = scope.model;
        if (model === null || model.form !== "table") continue;

        expect(model.anchors.length).toBeGreaterThanOrEqual(MIN_ANCHORS);
        expect(model.extrapolation).toBe("refuse");

        const descending =
          (model.anchors[1]?.countsPer360 ?? 0) < (model.anchors[0]?.countsPer360 ?? 0);
        for (let i = 1; i < model.anchors.length; i += 1) {
          const previous = model.anchors[i - 1];
          const current = model.anchors[i];
          if (previous === undefined || current === undefined) continue;
          expect(current.setting).toBeGreaterThan(previous.setting);
          expect(current.countsPer360 < previous.countsPer360).toBe(descending);
        }
      }
    });
  });
}

import { describe, expect, it } from "vitest";
import { LAUNCH_ADAPTERS, VERIFICATION_REGISTER, createLaunchRegistry } from "@/game-adapters";
import { createFixtureAdapter, createTableFixtureAdapter } from "@tests/helpers/fixture-adapter";
import { runAdapterConformance } from "@tests/helpers/adapter-conformance";

/**
 * Doc 12 §12.8 says every adapter ships with the eight test classes, "without exception".
 *
 * This file is how that stays true without discipline: the suite is enumerated over the
 * registry, so an adapter added tomorrow is covered tonight. The two fixtures exercise the
 * verified half — one per model form — and the five launch games exercise the unverified
 * half, which is the only half that exists in production today.
 */

for (const adapter of LAUNCH_ADAPTERS) {
  runAdapterConformance(adapter);
}

runAdapterConformance(createFixtureAdapter());
runAdapterConformance(createFixtureAdapter({ verifiedAdsScope: true }), {
  requiredLocales: ["en"],
});
runAdapterConformance(createTableFixtureAdapter());

describe("the conformance suite covers the whole registry", () => {
  it("enumerates every registered current adapter", () => {
    // If this drifts, the loop above stops covering something. The assertion is cheap and
    // the failure mode it prevents — a new game with no tests — is not.
    const registered = createLaunchRegistry()
      .listCurrent()
      .map((summary) => summary.gameId)
      .sort();
    const covered = LAUNCH_ADAPTERS.map((adapter) => adapter.identity.gameId).sort();
    expect(covered).toEqual(registered);
  });

  it("keeps test-fixture register entries out of production adapters", () => {
    // The fixture entries exist so the verified path can be tested at all. A real adapter
    // citing one would be claiming verification that governs nothing.
    const fixtureEntries = new Set(
      VERIFICATION_REGISTER.filter((entry) => entry.governs === "test_fixture").map(
        (entry) => entry.id,
      ),
    );
    for (const adapter of LAUNCH_ADAPTERS) {
      for (const entry of adapter.openRegisterEntries()) {
        expect(fixtureEntries.has(entry)).toBe(false);
      }
      for (const scope of adapter.scopes) {
        expect(fixtureEntries.has(scope.verification.registerEntry)).toBe(false);
      }
    }
  });
});

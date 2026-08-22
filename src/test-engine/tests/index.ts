import type { TestDefinition } from "../contracts";
import { comfort360Test } from "./comfort360";
import { flickTest } from "./flick";
import { microTest } from "./micro";
import { precisionTest } from "./precision";
import { reactionTest } from "./reaction";
import { switchingTest } from "./switching";
import { trackingTest } from "./tracking";

/**
 * The MVP test battery (doc 09 §9.1–§9.7).
 *
 * Seven tests, of which **five are scored** and drive the sensitivity comparison. The other two
 * are deliberately not:
 *
 *  - `reaction` is a **baseline**. It measures the player, not the sensitivity, and never enters
 *    the recommendation (`SENS-BR-006`). It exists so acquisition time can be decomposed.
 *  - `comfort360` is a **constraint**. It measures a workspace and bounds the search range, so
 *    the product cannot recommend a sensitivity the player physically cannot execute.
 *
 * Both run once per session rather than once per candidate: running a sensitivity-independent
 * test per candidate would spend the trial budget on a comparison that cannot differ.
 */

export * from "./comfort360";
export * from "./flick";
export * from "./micro";
export * from "./precision";
export * from "./reaction";
export * from "./switching";
export * from "./tracking";

/** Every MVP test, in the order doc 09 lists them. */
export const MVP_TESTS: readonly TestDefinition[] = [
  reactionTest,
  flickTest,
  microTest,
  trackingTest,
  switchingTest,
  precisionTest,
  comfort360Test,
];

/** The five tests whose results choose a sensitivity. */
export const SCORED_TESTS: readonly TestDefinition[] = MVP_TESTS.filter(
  (test) => test.category === "scored",
);

/** Tests that run once per session because their result cannot depend on sensitivity. */
export const SENSITIVITY_INDEPENDENT_TESTS: readonly TestDefinition[] = MVP_TESTS.filter(
  (test) => test.category !== "scored",
);

export function getTestDefinition(key: string): TestDefinition | undefined {
  return MVP_TESTS.find((test) => test.key === key);
}

import type { SessionMode } from "../../core/types/vocabulary";
import type { TestDefinition } from "../contracts";
import { adsTest } from "./ads";
import { comfort360Test } from "./comfort360";
import { flickTest } from "./flick";
import { microTest } from "./micro";
import { precisionTest } from "./precision";
import { reactionTest } from "./reaction";
import { recoilTest } from "./recoil";
import { slideTrackingTest } from "./slide-tracking";
import { speedTest } from "./speed";
import { strafeTrackingTest } from "./strafe-tracking";
import { switchingTest } from "./switching";
import { trackingTest } from "./tracking";
import { wideFlickTest } from "./wide-flick";

/**
 * The test battery (doc 09).
 *
 * ## MVP (§9.1–§9.7)
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
 *
 * ## Advanced (§9.8–§9.13, Phase 6)
 *
 * Six more scored tests that add *resolution*, not capability (doc 02 §2.3): the MVP five
 * already span the dimensions needed to locate the peak. They run in Advanced mode, where the
 * budget allows it, and Strafe and Slide Tracking are what finally give the Tracking dimension
 * a second source (doc 09 §9.15).
 */

export * from "./ads";
export * from "./comfort360";
export * from "./flick";
export * from "./micro";
export * from "./precision";
export * from "./reaction";
export * from "./recoil";
export * from "./slide-tracking";
export * from "./speed";
export * from "./strafe-tracking";
export * from "./switching";
export * from "./tracking";
export * from "./wide-flick";

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

/** The post-MVP tests, in the order doc 09 lists them. All scored. */
export const ADVANCED_TESTS: readonly TestDefinition[] = [
  wideFlickTest,
  strafeTrackingTest,
  slideTrackingTest,
  speedTest,
  recoilTest,
  adsTest,
];

export const ALL_TESTS: readonly TestDefinition[] = [...MVP_TESTS, ...ADVANCED_TESTS];

/** The five MVP tests whose results choose a sensitivity. */
export const SCORED_TESTS: readonly TestDefinition[] = MVP_TESTS.filter(
  (test) => test.category === "scored",
);

/** Tests that run once per session because their result cannot depend on sensitivity. */
export const SENSITIVITY_INDEPENDENT_TESTS: readonly TestDefinition[] = MVP_TESTS.filter(
  (test) => test.category !== "scored",
);

/**
 * The scored roster for a session mode (doc 09 §9.16).
 *
 * Quick runs the three highest-signal tests; Standard the MVP five; Advanced adds the post-MVP
 * tests. The ADS test needs a scoped round to run under and is added by the planner when the
 * session declares a scope, so it is not in the per-candidate hipfire roster here.
 */
export function scoredTestsForMode(mode: SessionMode): readonly TestDefinition[] {
  switch (mode) {
    case "quick":
      return [flickTest, microTest, trackingTest];
    case "advanced":
      return [
        ...SCORED_TESTS,
        wideFlickTest,
        strafeTrackingTest,
        slideTrackingTest,
        speedTest,
        recoilTest,
      ];
    case "standard":
    case "validation":
    case "fine_tune":
      return SCORED_TESTS;
  }
}

export function getTestDefinition(key: string): TestDefinition | undefined {
  return ALL_TESTS.find((test) => test.key === key);
}

import { wrapDegrees } from "../../core/geometry/angular";
import type { MetricDerivation, TrialObservation } from "../telemetry/metric-collector";
import { traceFor, type TrialTrace } from "./trace";

/**
 * The comfort family (doc 09 §9.7, doc 10 §10.5).
 *
 * These are **not performance metrics**. They measure a workspace — desk, pad, grip, reach —
 * and produce a hard physical constraint on the search range, so SensLab cannot recommend a
 * sensitivity the player is physically unable to use. No dimension score reads them.
 *
 * ## What is deliberately not computed here
 *
 * `comfortableSwipeCm` is defined in doc 10 as the swipe converted to physical centimetres,
 * which needs the mouse DPI. The engine does not know the DPI, and that is a deliberate
 * architectural choice: keeping DPI out is what makes degrees-per-count the engine's only
 * sensitivity concept and makes it DPI-independent by construction (doc 11 §11.1).
 *
 * So the engine emits the angle it can measure exactly — `maxSingleSwipeDeg` — and the
 * conversion to centimetres happens in the layer that holds the DPI. Emitting a centimetre
 * figure from here would mean inventing a DPI, which is exactly the kind of confident wrong
 * number this product exists to avoid.
 */

/** Sub-task labels, produced by the test's `variantFor` hook. */
export const COMFORT_SWIPE = "swipe";
export const COMFORT_HALF_TURN = "half_turn";
export const COMFORT_RETURN = "return";

/** Below this speed the hand is not sweeping — it is repositioning or has stopped. */
const LIFT_SPEED_DEG_PER_SEC = 8;
/** A pause this long mid-attempt is a lift and re-grip, not hesitation. */
const LIFT_DWELL_MS = 120;

/**
 * Indices at which a lift begins.
 *
 * A lift is a sustained near-stop *after* movement has started: the player has run out of pad,
 * picked the mouse up, and re-placed it. Requiring movement first is what stops the initial
 * stillness before the attempt from counting as a lift.
 */
function liftStarts(trace: TrialTrace): readonly number[] {
  const starts: number[] = [];
  let moving = false;
  let stoppedSince: number | null = null;
  let counted = false;

  for (let i = 1; i < trace.sampleCount; i += 1) {
    const time = trace.t[i] as number;
    const speed = trace.speed[i] as number;

    if (speed > LIFT_SPEED_DEG_PER_SEC) {
      moving = true;
      stoppedSince = null;
      counted = false;
      continue;
    }

    if (!moving) continue;
    stoppedSince ??= time;
    if (!counted && time - stoppedSince >= LIFT_DWELL_MS) {
      starts.push(i);
      counted = true;
    }
  }

  return starts;
}

/** Signed yaw displacement from the trial's origin at each sample, in degrees. */
function yawDisplacement(observation: TrialObservation, trace: TrialTrace, index: number): number {
  return (observation.inputSamples.yaw[index] as number) - observation.originAngles.yawDeg;
}

export const maxSingleSwipeDeg: MetricDerivation = {
  key: "maxSingleSwipeDeg",
  derive(observation) {
    if (observation.variant !== COMFORT_SWIPE) return null;
    const trace = traceFor(observation);
    if (trace.sampleCount === 0) return null;

    // "In one motion": the measurement ends at the first lift, because everything after it is
    // a second motion and would overstate the reach the player actually has.
    const firstLift = liftStarts(trace)[0] ?? trace.sampleCount;

    let furthest = 0;
    for (let i = 0; i < Math.min(firstLift, trace.sampleCount); i += 1) {
      const displacement = Math.abs(yawDisplacement(observation, trace, i));
      if (displacement > furthest) furthest = displacement;
    }

    return furthest;
  },
};

export const liftCount180: MetricDerivation = {
  key: "liftCount180",
  derive(observation) {
    if (observation.variant !== COMFORT_HALF_TURN) return null;
    return liftStarts(traceFor(observation)).length;
  },
};

export const time180: MetricDerivation = {
  key: "time180",
  derive(observation) {
    if (observation.variant !== COMFORT_HALF_TURN) return null;
    const confirm = traceFor(observation).firstPressTime;
    return confirm === null ? null : confirm - observation.stimulusAt;
  },
};

export const returnErrorDeg: MetricDerivation = {
  key: "returnErrorDeg",
  derive(observation) {
    if (observation.variant !== COMFORT_RETURN) return null;
    const trace = traceFor(observation);
    if (trace.sampleCount === 0) return null;

    // Measured at the confirming click, not at the trial's end: the player declares when they
    // believe they are back on the marked heading, and that declaration is the measurement.
    const confirm = trace.firstPressTime;
    let index = trace.sampleCount - 1;
    if (confirm !== null) {
      for (let i = 0; i < trace.sampleCount; i += 1) {
        if ((trace.t[i] as number) > confirm) break;
        index = i;
      }
    }

    // Wrapped, so a player who returns by continuing round rather than reversing is not
    // reported as 350° out when they are 10° out.
    return Math.abs(wrapDegrees(yawDisplacement(observation, trace, index)));
  },
};

export const COMFORT_DERIVATIONS: readonly MetricDerivation[] = [
  maxSingleSwipeDeg,
  liftCount180,
  time180,
  returnErrorDeg,
];

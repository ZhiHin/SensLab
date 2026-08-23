import type { MetricDerivation } from "../telemetry/metric-collector";
import { STOP_SPEED_DEG_PER_SEC, traceFor } from "./trace";

/**
 * Lift detection (doc 09 §9.8).
 *
 * A lift is a fact about the player's desk: the sensitivity demanded more physical travel
 * than one motion could supply, so the mouse came off the pad and went back down. It shows up
 * in the input stream as **stillness in the middle of a movement** — the crosshair stops well
 * short of the target, stays stopped, then resumes toward it.
 *
 * It is recorded as a measured fact and fed to the physical-constraint model. It is never a
 * performance penalty: a player who lifts has told us something about the sensitivity, not
 * about their aim.
 *
 * ## A lift is a gap
 *
 * A mouse in the air sends nothing. The stillness therefore shows up as a **gap between
 * consecutive samples**, not as a run of slow samples — and a detector that only looked at
 * sample speeds would see the re-grip land as one slow sample and miss the lift entirely.
 * Both signatures are checked: a gap of at least the pause length, or a run of below-threshold
 * samples spanning it.
 */

/** A pause must last at least this long to count as a lift rather than a hesitation. */
export const LIFT_PAUSE_MS = 80;
/** The pause must begin before this fraction of the distance is covered. */
export const LIFT_MAX_PROGRESS_FRACTION = 0.85;
/** The pause must begin after this fraction — a pause at the very start is reaction, not a lift. */
export const LIFT_MIN_PROGRESS_FRACTION = 0.1;

export const liftDetected: MetricDerivation = {
  key: "liftDetected",
  derive(observation) {
    const trace = traceFor(observation);
    if (trace.initialDistanceDeg === null || trace.sampleCount < 2) return null;
    const distance = trace.initialDistanceDeg;
    const firstEntry = trace.firstEntryTime ?? trace.resolvedAt;

    let stoppedSince: number | null = null;
    let stoppedAtProgress = 0;

    for (let i = 1; i < trace.sampleCount; i += 1) {
      const t = trace.t[i] as number;
      if (t > firstEntry) break;

      const progressFraction = (trace.progress[i] as number) / distance;
      const previousProgress = (trace.progress[i - 1] as number) / distance;
      const gapMs = t - (trace.t[i - 1] as number);

      // The mouse went quiet mid-flight and came back still heading for the target.
      if (
        gapMs >= LIFT_PAUSE_MS &&
        previousProgress >= LIFT_MIN_PROGRESS_FRACTION &&
        previousProgress <= LIFT_MAX_PROGRESS_FRACTION &&
        progressFraction > previousProgress
      ) {
        return 1;
      }

      const stopped = (trace.speed[i] as number) < STOP_SPEED_DEG_PER_SEC && gapMs < LIFT_PAUSE_MS;

      if (stopped) {
        if (stoppedSince === null) {
          stoppedSince = t;
          stoppedAtProgress = progressFraction;
        }
        continue;
      }

      // Movement resumed. A long enough pause, begun mid-flight, that is then followed by
      // more movement towards the target is the signature.
      if (
        stoppedSince !== null &&
        t - stoppedSince >= LIFT_PAUSE_MS &&
        stoppedAtProgress >= LIFT_MIN_PROGRESS_FRACTION &&
        stoppedAtProgress <= LIFT_MAX_PROGRESS_FRACTION &&
        progressFraction > stoppedAtProgress
      ) {
        return 1;
      }
      stoppedSince = null;
    }

    return 0;
  },
};

export const LIFT_DERIVATIONS: readonly MetricDerivation[] = [liftDetected];

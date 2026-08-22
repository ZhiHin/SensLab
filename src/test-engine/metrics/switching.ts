import { angularDistance } from "../../core/geometry/angular";
import { median } from "../../core/statistics";
import type { MetricDerivation, TrialObservation } from "../telemetry/metric-collector";
import type { LiveTarget } from "../targets/target-manager";
import { traceFor } from "./trace";

/**
 * The switching family (doc 10 §10.5).
 *
 * ## One trial, many measurements
 *
 * A switching trial is a *sequence*: eight kills produce seven switching intervals. The trial
 * record holds one value per metric, so the trial value is the **median** of the within-trial
 * intervals — a robust summary of that sequence, aggregated again across trials by the round.
 *
 * The alternative, pooling every interval from every trial as if it were an independent trial,
 * would overstate the sample size and shrink the confidence interval on a claim it has not
 * earned: intervals within one sequence share a player, a moment and a fatigue state.
 *
 * ## Travel time versus switching time
 *
 * `switchingTime` includes settling and trigger discipline; `switchingTravelTime` stops at the
 * moment the crosshair first touches the next target. The pair separates "slow to get there"
 * from "slow to commit", which respond to sensitivity differently.
 */

interface Engagement {
  readonly killedAt: number;
  /** The target killed next, and when the crosshair first entered it. */
  readonly nextEntryAt: number | null;
  readonly nextKilledAt: number;
}

/**
 * Reconstructs the sequence of engagements from the trial's targets and sample trace.
 *
 * Entry times are found by walking the input samples between one kill and the next, which is
 * exact: target motion is analytic, so the crosshair's distance to a target is computable at
 * any sample time.
 */
function engagements(observation: TrialObservation): readonly Engagement[] {
  const trace = traceFor(observation);
  const killed = observation.targets
    .filter(
      (live): live is LiveTarget & { destroyedAt: number } =>
        live.spec.role === "scored" && live.destroyedAt !== null,
    )
    .sort((a, b) => a.destroyedAt - b.destroyedAt);

  const out: Engagement[] = [];

  for (let k = 1; k < killed.length; k += 1) {
    const previous = killed[k - 1] as LiveTarget & { destroyedAt: number };
    const next = killed[k] as LiveTarget & { destroyedAt: number };

    let entryAt: number | null = null;
    for (let i = 0; i < trace.sampleCount; i += 1) {
      const time = trace.t[i] as number;
      if (time <= previous.destroyedAt) continue;
      if (time > next.destroyedAt) break;
      // The target must already exist: a respawn placed after the previous kill cannot have
      // been entered before it appeared.
      if (time < next.spawnedAt) continue;

      const position = observation.targetManager.positionAt(next, time);
      const crosshair = {
        yawDeg: observation.inputSamples.yaw[i] as number,
        pitchDeg: observation.inputSamples.pitch[i] as number,
      };
      if (angularDistance(crosshair, position) <= next.spec.angularRadiusDeg) {
        entryAt = time;
        break;
      }
    }

    out.push({
      killedAt: previous.destroyedAt,
      nextEntryAt: entryAt,
      nextKilledAt: next.destroyedAt,
    });
  }

  return out;
}

export const switchingTime: MetricDerivation = {
  key: "switchingTime",
  derive(observation) {
    const intervals = engagements(observation).map(
      (engagement) => engagement.nextKilledAt - engagement.killedAt,
    );
    return intervals.length === 0 ? null : median(intervals);
  },
};

export const switchingTravelTime: MetricDerivation = {
  key: "switchingTravelTime",
  derive(observation) {
    const intervals = engagements(observation)
      .filter((engagement) => engagement.nextEntryAt !== null)
      .map((engagement) => (engagement.nextEntryAt as number) - engagement.killedAt);
    return intervals.length === 0 ? null : median(intervals);
  },
};

export const SWITCHING_DERIVATIONS: readonly MetricDerivation[] = [
  switchingTime,
  switchingTravelTime,
];

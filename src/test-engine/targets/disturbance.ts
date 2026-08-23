import type { DisturbancePattern, TestRng } from "../contracts";

/**
 * Generated recoil (doc 09 §9.12).
 *
 * ## What this is, and is not
 *
 * A recoil pattern here is a **parametric family**: a vertical rise that saturates, a
 * horizontal drift whose sign flips on a seeded schedule, and a per-shot kick. Every number is
 * drawn from the session seed for the trial, so a pattern is unpredictable to the player and
 * exactly reproducible to the derivations.
 *
 * It is not, and does not attempt to be, any game's recoil. No weapon pattern from any product
 * is reproduced, sampled, approximated, or used as a reference — reproducing one would be both
 * a copyright question and a cheating-adjacent capability (doc 09 §9.12, legal note). What this
 * measures is compensation against a sustained, predictable-but-unmemorised disturbance, and a
 * generated family measures that at least as well as a copied one would.
 *
 * ## Held time
 *
 * The pattern develops as a function of cumulative **held** time, not wall time. Releasing
 * the button freezes it; pressing again resumes it. That keeps the disturbance a pure function
 * of something the derivations can reconstruct from the event stream.
 */

export type RecoilFamily = "steep-vertical" | "gradual-vertical" | "late-horizontal" | "wandering";

export const RECOIL_FAMILIES: readonly RecoilFamily[] = [
  "steep-vertical",
  "gradual-vertical",
  "late-horizontal",
  "wandering",
];

export interface RecoilGenerationOptions {
  readonly family: RecoilFamily;
  readonly burstMs: number;
  readonly shotIntervalMs: number;
}

/**
 * Draws one pattern from the family.
 *
 * The families differ in *shape*, not in difficulty: each is scaled so that a player who does
 * nothing ends the burst roughly the same angular distance off target. A family that was
 * simply harder would bias whichever candidate drew it.
 */
export function generateRecoil(rng: TestRng, options: RecoilGenerationOptions): DisturbancePattern {
  const { family, burstMs, shotIntervalMs } = options;
  const shots = Math.ceil(burstMs / shotIntervalMs) + 1;

  const jitter = Array.from({ length: shots }, () => ({
    yaw: rng.nextRange(-1, 1),
    pitch: rng.nextRange(-1, 1),
  }));

  // Family-specific shape. Vertical rise and horizontal drift are chosen so the total
  // displacement of an uncompensated burst is comparable across families (TUNABLE).
  let verticalRiseDeg: number;
  let verticalTimeConstantMs: number;
  let horizontalDriftDegPerSec: number;
  let signChanges: number[];

  switch (family) {
    case "steep-vertical":
      verticalRiseDeg = rng.nextRange(9, 12);
      verticalTimeConstantMs = rng.nextRange(180, 260);
      horizontalDriftDegPerSec = rng.nextRange(1, 2);
      signChanges = [rng.nextRange(0.45, 0.7) * burstMs];
      break;
    case "gradual-vertical":
      verticalRiseDeg = rng.nextRange(10, 13);
      verticalTimeConstantMs = rng.nextRange(450, 650);
      horizontalDriftDegPerSec = rng.nextRange(1, 2.5);
      signChanges = [rng.nextRange(0.3, 0.5) * burstMs];
      break;
    case "late-horizontal":
      verticalRiseDeg = rng.nextRange(6, 8);
      verticalTimeConstantMs = rng.nextRange(220, 320);
      horizontalDriftDegPerSec = rng.nextRange(4, 6);
      // The drift only matters late: a single flip well into the burst.
      signChanges = [rng.nextRange(0.55, 0.75) * burstMs];
      break;
    case "wandering":
      verticalRiseDeg = rng.nextRange(6, 9);
      verticalTimeConstantMs = rng.nextRange(250, 400);
      horizontalDriftDegPerSec = rng.nextRange(3, 5);
      signChanges = [
        rng.nextRange(0.2, 0.35) * burstMs,
        rng.nextRange(0.45, 0.6) * burstMs,
        rng.nextRange(0.7, 0.85) * burstMs,
      ];
      break;
  }

  return {
    kind: "recoil",
    family,
    burstMs,
    verticalRiseDeg,
    verticalTimeConstantMs,
    horizontalDriftDegPerSec,
    horizontalSignChangesMs: signChanges.sort((a, b) => a - b),
    horizontalInitialSign: rng.next() < 0.5 ? -1 : 1,
    shotIntervalMs,
    jitterDeg: rng.nextRange(0.25, 0.5),
    jitter,
  };
}

export interface DisturbanceOffset {
  readonly yawDeg: number;
  readonly pitchDeg: number;
}

/**
 * The camera offset at a given held time.
 *
 * Closed form throughout: the vertical rise is `V·(1 − e^(−τ/T))`, the horizontal drift is the
 * piecewise-linear integral of a signed constant, and the per-shot kick is a step indexed by
 * shot number. Beyond `burstMs` the pattern is held at its final value — the burst is over and
 * what remains is the player's recovery.
 */
export function evaluateDisturbance(
  pattern: DisturbancePattern,
  heldMs: number,
): DisturbanceOffset {
  if (heldMs <= 0) return { yawDeg: 0, pitchDeg: 0 };
  const tau = Math.min(heldMs, pattern.burstMs);

  const vertical = pattern.verticalRiseDeg * (1 - Math.exp(-tau / pattern.verticalTimeConstantMs));

  // Integrate the signed drift across the sign-change schedule.
  let horizontal = 0;
  let sign: number = pattern.horizontalInitialSign;
  let from = 0;
  for (const flipAt of pattern.horizontalSignChangesMs) {
    if (flipAt >= tau) break;
    horizontal += sign * pattern.horizontalDriftDegPerSec * ((flipAt - from) / 1000);
    sign = -sign;
    from = flipAt;
  }
  horizontal += sign * pattern.horizontalDriftDegPerSec * ((tau - from) / 1000);

  const shotIndex = Math.min(pattern.jitter.length - 1, Math.floor(tau / pattern.shotIntervalMs));
  const kick = pattern.jitter[shotIndex] ?? { yaw: 0, pitch: 0 };

  return {
    yawDeg: horizontal + kick.yaw * pattern.jitterDeg,
    pitchDeg: vertical + kick.pitch * pattern.jitterDeg,
  };
}

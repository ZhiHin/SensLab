import type { AlgorithmKind } from "../types/vocabulary";
import { AIM_PROFILE_RULES_V1 } from "./aim-profile-rules-v1";
import { CALIBRATION_MODEL_V1 } from "./calibration-model-v1";
import { CALIBRATION_MODEL_V2 } from "./calibration-model-v2";
import { CALIBRATION_MODEL_V3 } from "./calibration-model-v3";
import { CONFIDENCE_MODEL_V1 } from "./confidence-model-v1";
import { REFERENCE_DIST_PROVISIONAL_V1 } from "./reference-dist-provisional-v1";
import { REFERENCE_DIST_PROVISIONAL_V2 } from "./reference-dist-provisional-v2";
import { SCORING_MODEL_V1 } from "./scoring-model-v1";
import { SCORING_MODEL_V2 } from "./scoring-model-v2";
import type { ParameterSet } from "./types";

export * from "./types";
export * from "./aim-profile-rules-v1";
export * from "./calibration-model-v1";
export * from "./calibration-model-v2";
export * from "./calibration-model-v3";
export * from "./confidence-model-v1";
export * from "./reference-dist-provisional-v1";
export * from "./reference-dist-provisional-v2";
export * from "./scoring-model-v1";
export * from "./scoring-model-v2";

/**
 * The parameter set **currently in force** for each algorithm kind — exactly one per kind.
 *
 * The loader in `lib/parameter-registry` hashes these and verifies the hashes against the
 * `algorithm_versions` rows at boot. A mismatch means the code and the database disagree
 * about what produced a stored result, which is a startup failure rather than a warning.
 */
// The sets have heterogeneous `params` shapes by design. The registry only reads the
// envelope and serialises `params` wholesale, so `unknown` is the honest element type —
// no `any`, and every concrete set stays fully typed at its own call sites.
export const ALL_PARAMETER_SETS: readonly ParameterSet<unknown>[] = Object.freeze([
  SCORING_MODEL_V2,
  CALIBRATION_MODEL_V3,
  CONFIDENCE_MODEL_V1,
  AIM_PROFILE_RULES_V1,
  REFERENCE_DIST_PROVISIONAL_V2,
]);

/**
 * Superseded sets that remain compiled (`SENS-BR-020`, `SENS-BR-029`).
 *
 * A result generated under `scoring_model_v1` must keep rendering under `scoring_model_v1`.
 * Keeping the set compiled — and its hash verified at boot alongside the current one — is
 * what makes that true rather than aspirational. Nothing new is ever generated under these.
 */
export const HISTORICAL_PARAMETER_SETS: readonly ParameterSet<unknown>[] = Object.freeze([
  SCORING_MODEL_V1,
  CALIBRATION_MODEL_V1,
  CALIBRATION_MODEL_V2,
  REFERENCE_DIST_PROVISIONAL_V1,
]);

/** Every released set, current and historical: what the seed writes and the boot check reads. */
export const RELEASED_PARAMETER_SETS: readonly ParameterSet<unknown>[] = Object.freeze([
  ...ALL_PARAMETER_SETS,
  ...HISTORICAL_PARAMETER_SETS,
]);

/** The version currently in force for each algorithm kind. */
export const CURRENT_VERSIONS: Readonly<Record<AlgorithmKind, string>> = Object.freeze({
  scoring: SCORING_MODEL_V2.version,
  calibration: CALIBRATION_MODEL_V3.version,
  confidence: CONFIDENCE_MODEL_V1.version,
  aim_profile: AIM_PROFILE_RULES_V1.version,
  reference_distribution: REFERENCE_DIST_PROVISIONAL_V2.version,
});

/** Resolves any released set by version label, current or historical. */
export function findParameterSet(version: string): ParameterSet<unknown> | undefined {
  return RELEASED_PARAMETER_SETS.find((set) => set.version === version);
}

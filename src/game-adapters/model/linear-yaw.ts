import { countsPer360FromDegreesPerCount, degreesPerCount } from "../../core/sensitivity/canonical";
import { ok, type Result } from "../../core/types/result";
import type { ModelError } from "./errors";

/**
 * Form A — the linear yaw constant (doc 11 §11.2, doc 12 §12.5).
 *
 * ```
 * deg_per_count  = setting × yaw
 * counts_per_360 = 360 / (setting × yaw)
 * ```
 *
 * `yaw` is the degrees a single mouse count turns the view at setting 1. It is an engine
 * constant, it is a **measured** quantity, and this module never supplies one: the parameters
 * arrive from an adapter whose register entry has been closed with evidence. Nothing here
 * knows which game it is describing, or whether any game uses this form at all.
 *
 * The relationship is exactly invertible with no numerical work, which is the whole appeal
 * of the form — and the reason it must never be *assumed* for a game that has not been
 * measured at two separated points (doc 08 §8.5 step 2).
 */

export interface LinearYawParams {
  readonly form: "linear_yaw";
  /** Degrees of view rotation per mouse count at setting = 1. Measured, never assumed. */
  readonly yawDegPerCountAtSettingOne: number;
}

export function assertLinearYawParams(params: LinearYawParams): void {
  const yaw = params.yawDegPerCountAtSettingOne;
  if (!Number.isFinite(yaw) || yaw <= 0) {
    throw new RangeError(`yaw constant must be a positive finite number, received ${yaw}`);
  }
}

export function linearYawCountsForSetting(
  params: LinearYawParams,
  settingValue: number,
): Result<number, ModelError> {
  return ok(countsPer360FromDegreesPerCount(settingValue * params.yawDegPerCountAtSettingOne));
}

export function linearYawSettingForCounts(
  params: LinearYawParams,
  counts: number,
): Result<number, ModelError> {
  return ok(degreesPerCount(counts) / params.yawDegPerCountAtSettingOne);
}

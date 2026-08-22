import type { Result } from "../../core/types/result";
import type { ModelForm } from "../../core/types/vocabulary";
import type { ModelError } from "./errors";
import {
  assertLinearYawParams,
  linearYawCountsForSetting,
  linearYawSettingForCounts,
  type LinearYawParams,
} from "./linear-yaw";
import {
  assertTableParams,
  tableCountsForSetting,
  tableSettingForCounts,
  type TableParams,
} from "./table";

export * from "./errors";
export * from "./linear-yaw";
export * from "./table";
export * from "./quantise";

/**
 * A game's sensitivity model, as a closed union over the forms SensLab implements.
 *
 * Doc 11 §11.2 names three forms. Two are implemented here because two are general: a
 * linear yaw constant and a table of measured anchors between them cover any monotone
 * relationship a measurement campaign can establish. Form C — piecewise, with declared
 * breakpoints — is deliberately absent: doc 12 §12.5 requires an *individually reviewed
 * module with a documented derivation*, which means it arrives with the game that needs it
 * and not before. Adding a variant here is the extension point.
 *
 * Note what the union does not contain: a default. There is no form a game falls back to,
 * because "assume linear" is precisely the guess `SENS-BR-013` forbids and doc 08 §8.3.3
 * singles out as the most likely way for this product to ship a silently wrong number.
 */
export type SensitivityModel = LinearYawParams | TableParams;

export function modelForm(model: SensitivityModel): ModelForm {
  return model.form;
}

/** Validates parameters at construction time, so a malformed model cannot be registered. */
export function assertModelParams(model: SensitivityModel): void {
  switch (model.form) {
    case "linear_yaw":
      assertLinearYawParams(model);
      return;
    case "table":
      assertTableParams(model);
      return;
  }
}

/** Game setting → counts per 360. */
export function countsForSetting(
  model: SensitivityModel,
  settingValue: number,
): Result<number, ModelError> {
  switch (model.form) {
    case "linear_yaw":
      return linearYawCountsForSetting(model, settingValue);
    case "table":
      return tableCountsForSetting(model, settingValue);
  }
}

/** Counts per 360 → game setting, before clamping and quantisation. */
export function settingForCounts(
  model: SensitivityModel,
  counts: number,
): Result<number, ModelError> {
  switch (model.form) {
    case "linear_yaw":
      return linearYawSettingForCounts(model, counts);
    case "table":
      return tableSettingForCounts(model, counts);
  }
}

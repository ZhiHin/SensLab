import type { CountsPer360, Dpi } from "../core/types/brand";
import type { Result } from "../core/types/result";
import type {
  AdsModel,
  ConversionMethod,
  FovAxis,
  GameRegion,
  ModelForm,
  ScopeKey,
  VerificationStatus,
} from "../core/types/vocabulary";
import type { MatchCriterion } from "../core/sensitivity/fov";
import type { SensitivityModel } from "./model";
import type { ScopeOptics } from "./scoped";

/**
 * The game adapter contract (doc 12 §12.3).
 *
 * This is the only layer in SensLab that knows a game exists. Everything upstream of it —
 * the test engine, the metrics, the scoring, the calibration search — reasons purely in
 * counts/360 and must never learn a game's name. ESLint zones enforce that boundary; this
 * file defines what sits on the far side of it.
 */

/* ------------------------------------------------------------------ identity */

export interface LocalisedText {
  readonly en: string;
  readonly "zh-Hans"?: string;
  readonly [locale: string]: string | undefined;
}

export interface AdapterIdentity {
  /** Stable slug, e.g. "cs2". Matches `games.slug`. */
  readonly gameId: string;
  /** The specific build this adapter is valid for. Matches `game_versions.version_label`. */
  readonly gameVersionLabel: string;
  /** Semver of the adapter module itself. Bumped when emitted numbers could change. */
  readonly adapterVersion: string;
  readonly displayName: LocalisedText;
  readonly region: GameRegion;
  readonly engineFamily?: string;
}

/* ------------------------------------------------------------------ verification */

/**
 * One reading from the verification procedure (doc 08 §8.5).
 *
 * A cm/360 at a known DPI and a known setting is exactly what step 4 produces — the 360°
 * alignment measurement yields the canonical unit directly, with no intermediate angle
 * estimation. Storing what was *measured* rather than a constant derived from it means the
 * derivation can be re-checked, and it is what the golden-vector test replays.
 */
export interface VerificationMeasurement {
  readonly scopeKey: ScopeKey;
  readonly settingValue: number;
  readonly dpi: number;
  readonly measuredCmPer360: number;
  /** How the count displacement was executed (doc 08 §8.5 step 3). */
  readonly method: string;
}

export interface VerificationEvidence {
  /** ISO-8601 instant at which the verification procedure was completed. */
  readonly verifiedAt: string;
  /** The game build the measurements were taken against. */
  readonly verifiedAgainstBuild: string;
  /** Pointers to the recorded evidence — register entry ids, measurement records. */
  readonly sourceRefs: readonly string[];
  /** Two-person sign-off, per doc 08 §8.2. */
  readonly signedOffBy: readonly [string, string];
  /**
   * The raw readings the model was derived from.
   *
   * Required, and checked at construction: `createVerifiedAdapter` refuses a scope whose
   * declared model does not reproduce these within ±0.5% (doc 08 §8.5 step 7). This is the
   * only check in the system that compares a model against *reality* rather than against
   * itself — a wrong constant passes every other test in the suite while being uniformly
   * wrong, and this is what catches it.
   */
  readonly measurements: readonly VerificationMeasurement[];
}

export interface ScopeVerification {
  readonly status: VerificationStatus;
  /**
   * Present only when the status is `verified` or `needs_recheck`. An adapter that claims
   * verification without evidence is rejected at registration.
   */
  readonly evidence?: VerificationEvidence;
  /** The external-verification register entry that governs this scope, e.g. "EV-001". */
  readonly registerEntry: string;
}

/* ------------------------------------------------------------------ model description */

export interface SettingRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly decimals: number;
}

export interface ScopeDefinition {
  readonly scopeKey: ScopeKey;
  readonly displayName: LocalisedText;
  /** The in-game label the user must look for. Wrong here makes the number unusable. */
  readonly settingLabel: LocalisedText;
  readonly magnification?: number;
  readonly hasSeparateSetting: boolean;
  readonly modelForm: ModelForm | null;
  /**
   * The measured parameters. `null` whenever the scope is unverified — an unmeasured scope
   * has no model, and declaring one "provisionally" is the guess `SENS-BR-013` forbids.
   */
  readonly model: SensitivityModel | null;
  readonly settingRange: SettingRange | null;
  /** How this scope's field of view is known. `null` until verification establishes it. */
  readonly optics: ScopeOptics | null;
  readonly adsModel: AdsModel;
  readonly fovAxis?: FovAxis;
  readonly fovScaling?: string;
  readonly defaultCriterion?: MatchCriterion;
  readonly verification: ScopeVerification;
}

/* ------------------------------------------------------------------ conversion I/O */

export interface ConversionContext {
  readonly dpi: Dpi | number;
  readonly scopeKey: ScopeKey;
  /** Horizontal half-FOV of the player's hipfire configuration, when relevant. */
  readonly hipfireHalfFovDegrees?: number;
  readonly aspectRatio?: number;
  /** Overrides the scope's default matching criterion (FR-085). */
  readonly criterion?: MatchCriterion;
  /**
   * What the supplied counts/360 refers to. Defaults to `"hipfire"`.
   *
   * The calibration engine recommends a *hipfire* value and scoped values are derived from it
   * (doc 11 §11.7), so the default is the product's case: hand `fromCanonical` the hipfire
   * target and a scope key, and it applies the matching criterion for you.
   *
   * `"scope"` says the value is already this scope's own target — which is what the ADS and
   * Scope Calibration tests will produce once scoped sensitivities are *measured* rather than
   * derived. It is a statement about the input's meaning, not a way around the gate: an
   * unverified scope refuses under either basis.
   */
  readonly canonicalBasis?: "hipfire" | "scope";
}

/**
 * One emitted setting. An adapter may return several for a single scope — Apex's per-optic
 * system needs a global multiplier *and* a per-optic value (doc 12 §12.11), which is why
 * this is a list rather than a scalar.
 */
export interface EmittedSetting {
  /** Machine key for the field, e.g. "sensitivity", "ads_multiplier". */
  readonly key: string;
  readonly label: LocalisedText;
  /** The value before clamping and quantisation. Diagnostics only; never displayed alone. */
  readonly idealValue: number;
  /** The value the user actually types in, after clamping and quantisation. */
  readonly value: number;
  readonly clamped: boolean;
}

export interface ConversionSuccess {
  readonly settings: readonly EmittedSetting[];
  /** Recomputed from the quantised settings — this is what the player will actually get. */
  readonly achievedCountsPer360: CountsPer360;
  readonly achievedCmPer360: number;
  /** Signed percentage difference between achieved and requested. */
  readonly quantisationErrorPct: number;
  readonly conversionMethod: ConversionMethod;
  readonly conversionCoefficient: number | null;
  readonly adapterVersion: string;
  readonly gameVersionLabel: string;
  readonly verification: VerificationStatus;
  /** Present when the status is `needs_recheck`, so the UI can say when it was last checked. */
  readonly lastVerifiedAt?: string;
}

/**
 * Why a conversion produced no number.
 *
 * `EXTERNAL_VERIFICATION_REQUIRED` is the important one: it is returned whenever SensLab has
 * not completed its own verification procedure for this game version and scope. There is no
 * code path that turns it into an approximate value, an estimate, or a disclaimed guess
 * (`SENS-BR-013`, `SENS-BR-014`).
 */
export type ConversionFailureCode =
  | "EXTERNAL_VERIFICATION_REQUIRED"
  | "UNSUPPORTED_SCOPE"
  | "OUTSIDE_MEASURED_RANGE"
  | "SETTING_OUT_OF_RANGE"
  | "MISSING_CONTEXT";

export interface ConversionFailure {
  readonly code: ConversionFailureCode;
  readonly gameId: string;
  readonly gameVersionLabel: string;
  readonly scopeKey: ScopeKey;
  /** For `EXTERNAL_VERIFICATION_REQUIRED`, the register entry that is still open. */
  readonly registerEntry?: string;
  /** Human-readable detail for logs and support. Never rendered as a substitute for a value. */
  readonly detail: string;
}

export type ConversionOutcome = Result<ConversionSuccess, ConversionFailure>;

export interface CanonicalisationSuccess {
  readonly countsPer360: CountsPer360;
  readonly cmPer360: number;
  readonly adapterVersion: string;
  readonly gameVersionLabel: string;
}

export type CanonicalisationOutcome = Result<CanonicalisationSuccess, ConversionFailure>;

export interface SettingValidation {
  readonly valid: boolean;
  readonly reason?: "below_min" | "above_max" | "not_on_step" | "unsupported_scope" | "unverified";
  readonly range?: SettingRange;
}

/* ------------------------------------------------------------------ the adapter */

export interface GameAdapter {
  readonly identity: AdapterIdentity;
  readonly scopes: readonly ScopeDefinition[];

  /** Overall status across scopes: `verified` only when every declared scope is verified. */
  verificationStatus(): VerificationStatus;
  scopeVerification(scopeKey: ScopeKey): ScopeVerification | null;

  /**
   * External-verification register entries still outstanding for this adapter.
   *
   * Declared explicitly rather than derived from the scope list, because an adapter that has
   * not been verified at all does not yet know its scope roster — and "we do not know what
   * scopes this game has" must not become "there is nothing outstanding". This is what lets
   * the UI say *which* verification work is open (doc 04 §4.4.11).
   */
  openRegisterEntries(): readonly string[];

  /** Game setting → canonical. Refuses for unverified scopes. */
  toCanonical(settingValue: number, context: ConversionContext): CanonicalisationOutcome;

  /** Canonical → game setting. Refuses for unverified scopes. */
  fromCanonical(counts: CountsPer360 | number, context: ConversionContext): ConversionOutcome;

  /**
   * Range/step check for form validation, separate from conversion so that the hardware
   * setup form can say "3.5 is outside this game's range" without performing a conversion.
   */
  validate(settingValue: number, scopeKey: ScopeKey): SettingValidation;
}

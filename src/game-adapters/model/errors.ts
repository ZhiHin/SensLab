/**
 * Why a sensitivity model declined to produce a number.
 *
 * These map onto `ConversionFailureCode` at the adapter boundary. They are kept separate so
 * that the model layer stays a pure numerical component with no knowledge of games, scopes
 * or verification.
 */
export interface ModelError {
  readonly code: "OUTSIDE_MEASURED_RANGE" | "SETTING_OUT_OF_RANGE";
  readonly detail: string;
}

export const modelError = (code: ModelError["code"], detail: string): ModelError => ({
  code,
  detail,
});

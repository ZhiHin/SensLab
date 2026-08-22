import type { VerificationStatus } from "@/core/types/vocabulary";
import type { ConversionFailureCode, StatusTone } from "./contracts";

/**
 * Wording for the verification states (doc 04 §4.4.11, doc 25 §25.10).
 *
 * The tone this file has to hit is the whole product's tone: *we have not measured this* is a
 * designed, supported outcome, not an apology and not an error. A user who lands on an
 * unverified game should come away understanding that their result is real and that the
 * missing piece is a number they could type into a menu — not that something broke.
 *
 * No game is named anywhere in this file. Every string is chosen by status, and the game's
 * own name arrives as data from the adapter.
 */

export interface StatusCopy {
  readonly label: string;
  readonly tone: StatusTone;
  readonly summary: string;
}

export const STATUS_COPY: Readonly<Record<VerificationStatus, StatusCopy>> = {
  verified: {
    label: "Verified",
    tone: "verified",
    summary:
      "We measured this game ourselves and recorded the evidence. The settings below are derived from that measurement.",
  },
  needs_recheck: {
    label: "Re-check due",
    tone: "caution",
    summary:
      "This was verified against an earlier build. The settings below still come from that measurement, and we are re-checking it.",
  },
  partial: {
    label: "Partly verified",
    tone: "caution",
    summary:
      "Some parts of this game have been measured and some have not. Only the measured ones produce a setting.",
  },
  unverified: {
    label: "Not verified",
    tone: "unverified",
    summary:
      "We have not measured this game's sensitivity model, so we will not print a number for it. Your result below is still complete.",
  },
};

export const REFUSAL_COPY: Readonly<Record<ConversionFailureCode, string>> = {
  EXTERNAL_VERIFICATION_REQUIRED:
    "We have not completed our own verification for this game, so there is no setting to show. Guessing one would be worse than showing none.",
  UNSUPPORTED_SCOPE: "This game does not offer that scope.",
  OUTSIDE_MEASURED_RANGE:
    "Your sensitivity falls outside the range we have measured for this game, and we do not extrapolate beyond our measurements.",
  SETTING_OUT_OF_RANGE: "That value is outside the range this game accepts.",
  MISSING_CONTEXT: "This conversion needs your in-game field of view, which we do not have yet.",
};

/**
 * What is still true when there is no game number.
 *
 * This is the single most important paragraph on the page. The measurement is in counts per
 * 360 and does not depend on any game, so an open register entry costs the user a
 * convenience, not their result (`SENS-BR-025`, doc 11 §11.9.4).
 */
export const CANONICAL_STILL_VALID =
  "Your calibrated sensitivity is a physical distance, not a game setting. It is correct whatever we know about any particular game, and you can use it in any game by matching the centimetres per 360°.";

export const WHY_NO_NUMBER =
  "SensLab only prints a game setting once it has measured that game itself, against a specific build, with the measurements recorded. Community values, calculators and plausible-looking constants are not evidence.";

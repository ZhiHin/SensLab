import type { InvalidReason, SessionQualityFlag } from "../../core/types/vocabulary";
import { DEFAULT_FRAME_THRESHOLDS, type FrameThresholds } from "../timing/frame-monitor";

/**
 * Environmental quality monitoring (doc 19 §19.10, `SENS-BR-010`).
 *
 * The monitor **classifies; it never modifies a measurement**. That separation is the whole
 * mechanism behind `SENS-BR-009`: everything this file can conclude is about the *environment*
 * — a dropped frame, a lost pointer lock, a hidden tab, an impossible hand velocity — and none
 * of it is about how well the player aimed. There is deliberately no path by which a poor
 * result can invalidate a trial.
 *
 * Degradation is always recorded and always surfaced. A recommendation built on a stuttering
 * session is not comparable to one built on a clean session, and once the session is over
 * nothing downstream can tell the difference.
 */

export interface QualityThresholds extends FrameThresholds {
  /**
   * Counts per second beyond which the implied hand movement is physically impossible.
   *
   * Supplied by the planner rather than derived here, because the bound is physical
   * (~8 m/s of hand movement) and converting it to counts needs the DPI — which the engine
   * deliberately does not know. Keeping DPI out of the engine is what makes degrees-per-count
   * the only sensitivity concept it handles (doc 11 §11.1).
   */
  readonly maxImpliedCountsPerSecond: number;
  /** Pointer-lock losses in one round beyond which the session is flagged. */
  readonly lockLossFlagThreshold: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  ...DEFAULT_FRAME_THRESHOLDS,
  // 8 m/s at 3200 DPI is ~1,000,000 counts/s. The planner overrides this from the real DPI;
  // the default is deliberately permissive so that an unset value never invalidates a trial.
  maxImpliedCountsPerSecond: 4_000_000,
  lockLossFlagThreshold: 3,
};

export interface QualityMonitor {
  /** Marks the start of a measured window. */
  openTrial(): void;
  /** Records a movement sample for the velocity plausibility check. */
  observeMovement(t: number, dx: number, dy: number): void;
  notePointerLockLost(): void;
  noteFocusLost(): void;
  noteSurfaceChange(reason: "resize" | "device_pixel_ratio"): void;
  noteBufferOverflow(): void;

  /**
   * The reason the *current trial* must be invalidated, or null.
   * Checked at trial close; the first environmental fault wins.
   */
  trialInvalidReason(): InvalidReason | null;
  /** Quality flags accumulated for the current trial. */
  trialFlags(): readonly string[];
  /** Clears per-trial state. Session totals are retained. */
  closeTrial(): void;

  readonly lockLossCount: number;
  readonly focusLossCount: number;
  readonly surfaceChangeCount: number;
  /** Session-level flags for `session_quality_flags` (doc 20 §20.7). */
  sessionFlags(options: {
    readonly rawInputEffective: boolean;
    readonly cleanFrameFraction: number;
  }): readonly SessionQualityFlag[];
}

export function createQualityMonitor(
  thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
): QualityMonitor {
  let lockLossCount = 0;
  let focusLossCount = 0;
  let surfaceChangeCount = 0;

  let trialOpen = false;
  let trialReason: InvalidReason | null = null;
  const trialFlagSet = new Set<string>();

  let lastSampleTime: number | null = null;

  const fault = (reason: InvalidReason): void => {
    // First fault wins: a trial invalidated by a lost pointer lock is not made more invalid by
    // the focus loss that followed it, and the first cause is the informative one.
    if (trialOpen && trialReason === null) trialReason = reason;
  };

  return {
    get lockLossCount() {
      return lockLossCount;
    },
    get focusLossCount() {
      return focusLossCount;
    },
    get surfaceChangeCount() {
      return surfaceChangeCount;
    },

    openTrial(): void {
      trialOpen = true;
      trialReason = null;
      trialFlagSet.clear();
      lastSampleTime = null;
    },

    observeMovement(t: number, dx: number, dy: number): void {
      const previous = lastSampleTime;
      lastSampleTime = t;
      if (previous === null) return;

      const deltaMs = t - previous;
      if (deltaMs <= 0) return;

      const counts = Math.hypot(dx, dy);
      const countsPerSecond = (counts / deltaMs) * 1000;

      // Anti-manipulation, not data cleaning (doc 10 §10.8): a rate no hand can produce means
      // the input did not come from a hand.
      if (countsPerSecond > thresholds.maxImpliedCountsPerSecond) {
        fault("impossible_velocity");
      }
    },

    notePointerLockLost(): void {
      lockLossCount += 1;
      fault("pointer_lock_lost");
    },

    noteFocusLost(): void {
      focusLossCount += 1;
      fault("focus_lost");
    },

    noteSurfaceChange(reason): void {
      surfaceChangeCount += 1;
      trialFlagSet.add(reason === "resize" ? "window_resized" : "device_pixel_ratio_changed");
    },

    noteBufferOverflow(): void {
      trialFlagSet.add("buffer_overflow");
    },

    trialInvalidReason(): InvalidReason | null {
      return trialReason;
    },

    trialFlags(): readonly string[] {
      return [...trialFlagSet].sort();
    },

    closeTrial(): void {
      trialOpen = false;
      trialReason = null;
      trialFlagSet.clear();
      lastSampleTime = null;
    },

    sessionFlags({ rawInputEffective, cleanFrameFraction }): readonly SessionQualityFlag[] {
      const flags: SessionQualityFlag[] = [];

      if (!rawInputEffective) flags.push("no_raw_input");
      if (cleanFrameFraction < thresholds.sessionWarningCleanFraction) {
        flags.push("frame_degradation");
      }
      if (lockLossCount >= thresholds.lockLossFlagThreshold) flags.push("unstable_pointer_lock");
      if (surfaceChangeCount > 0) flags.push("window_resized");

      return flags;
    },
  };
}

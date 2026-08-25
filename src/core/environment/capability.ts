/**
 * The calibration capability gate (`SENS-UX-026`, FR-100, `SENS-BR-023`).
 *
 * ```
 *   fine pointer  ∧  hover  ∧  viewport ≥ 1024 × 640  ∧  Pointer Lock
 * ```
 *
 * ## Capability, never user agent
 *
 * A tablet with a mouse attached passes. A phone in desktop mode does not, because it still
 * has no fine pointer. A desktop in a small window is asked to enlarge rather than told it is
 * a phone — a distinct state, because the mobile explanation would be confusing and wrong.
 *
 * The alternative — sniffing the user agent — would be wrong in both directions on the exact
 * devices that matter, and would need editing every time a vendor changed a string.
 *
 * ## Why a gate at all
 *
 * SensLab measures counts of physical mouse movement. A touch surface reports positions, not
 * counts, and has no pointer lock to make a 360° turn possible at all: a touch calibration
 * would be a different measurement wearing this one's name. Offering it would be the single
 * most damaging dishonesty available here, so the product declines (`SENS-BR-023`, doc 01
 * §1.7).
 */

export const MIN_VIEWPORT_WIDTH = 1024;
export const MIN_VIEWPORT_HEIGHT = 640;

export interface Capabilities {
  /** `(pointer: fine)` — a mouse, trackpad or stylus rather than a finger. */
  readonly finePointer: boolean;
  /** `(hover: hover)` — a pointer that can rest over a target without committing. */
  readonly hover: boolean;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly pointerLock: boolean;
}

export type GateVerdict =
  /** Every requirement met. */
  | "ready"
  /** A pointing device that cannot do this measurement — SCR-050. */
  | "needs_desktop"
  /** The right device, a window too small to hold the test — a distinct, fixable state. */
  | "window_too_small"
  /** The right device, a browser without Pointer Lock — SCR-051. */
  | "browser_unsupported";

export interface GateResult {
  readonly verdict: GateVerdict;
  /** Which requirements failed, most-blocking first, for the explanation. */
  readonly missing: readonly ("pointer" | "hover" | "size" | "pointer_lock")[];
  readonly required: { readonly width: number; readonly height: number };
}

export function evaluateGate(capabilities: Capabilities): GateResult {
  const missing: GateResult["missing"][number][] = [];
  if (!capabilities.finePointer) missing.push("pointer");
  if (!capabilities.hover) missing.push("hover");
  if (
    capabilities.viewportWidth < MIN_VIEWPORT_WIDTH ||
    capabilities.viewportHeight < MIN_VIEWPORT_HEIGHT
  ) {
    missing.push("size");
  }
  if (!capabilities.pointerLock) missing.push("pointer_lock");

  const required = { width: MIN_VIEWPORT_WIDTH, height: MIN_VIEWPORT_HEIGHT };

  // Order matters: a phone fails the pointer test *and* the size test, and telling its owner to
  // enlarge the window would be advice they cannot follow. The input device is checked first.
  if (!capabilities.finePointer || !capabilities.hover) {
    return { verdict: "needs_desktop", missing, required };
  }
  if (!capabilities.pointerLock) {
    return { verdict: "browser_unsupported", missing, required };
  }
  if (missing.includes("size")) {
    return { verdict: "window_too_small", missing, required };
  }
  return { verdict: "ready", missing, required };
}

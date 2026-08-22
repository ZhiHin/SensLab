/**
 * The input seam (doc 19 §19.4).
 *
 * The engine consumes an `InputSource` rather than reading DOM events directly. That is what
 * lets the headless harness feed a synthetic movement trace with exact timestamps and assert
 * the exact resulting trial record — the majority of the engine's tests live behind this
 * interface (doc 19 §19.12).
 */

/** One movement sample, in raw mouse counts, at a monotonic timestamp. */
export interface MovementSample {
  readonly t: number;
  readonly dx: number;
  readonly dy: number;
}

export type ButtonPhase = "down" | "up";

export interface ButtonEvent {
  readonly t: number;
  /** 0 = primary. SensLab only measures the primary button. */
  readonly button: number;
  readonly phase: ButtonPhase;
}

export type SurfaceChangeReason = "resize" | "device_pixel_ratio";

/**
 * What the engine receives from the input source.
 *
 * `onMove` is called once per *sample*, not once per frame. An 8000 Hz mouse produces 8000
 * calls per second while the renderer still runs at display rate, which is what a game does
 * and what `SENS-NFR-001` requires. Integrating per frame instead would quantise input to the
 * frame rate and discard the sub-frame ordering a high-polling mouse exists to provide.
 */
export interface InputSink {
  onMove(sample: MovementSample): void;
  onButton(event: ButtonEvent): void;
  onLockChange(locked: boolean): void;
  onFocusChange(focused: boolean): void;
  onSurfaceChange(reason: SurfaceChangeReason): void;
  onKey(key: string, t: number): void;
}

/**
 * The result of a pointer-lock request.
 *
 * `unadjustedMovementEffective` is deliberately distinct from `...Requested`: the browser may
 * accept the option and ignore it, and the engine must record what actually took effect rather
 * than what was asked for. Where the API does not report it, the environment check's
 * movement-scale probe is the fallback (EV-010).
 */
export interface LockOutcome {
  readonly locked: boolean;
  readonly unadjustedMovementRequested: boolean;
  readonly unadjustedMovementEffective: boolean;
  /** Populated when the lock could not be acquired. Diagnostic only; never shown verbatim. */
  readonly failureReason?: string;
}

export interface InputSourceState {
  readonly locked: boolean;
  readonly unadjustedMovementEffective: boolean;
  readonly focused: boolean;
}

export interface InputSource {
  attach(sink: InputSink): void;
  detach(): void;
  requestLock(): Promise<LockOutcome>;
  releaseLock(): void;
  readonly state: InputSourceState;
}

import type {
  ButtonEvent,
  InputSink,
  InputSource,
  InputSourceState,
  LockOutcome,
  MovementSample,
} from "./types";

/**
 * The browser input source: Pointer Lock plus coalesced pointer events.
 *
 * ## Raw movement
 *
 * `requestPointerLock({ unadjustedMovement: true })` asks the browser for movement deltas that
 * have *not* passed through the OS pointer pipeline. Without it, Windows pointer speed and
 * Enhance Pointer Precision can distort every measurement — and EPP in particular is a
 * velocity-dependent curve that cannot be inverted from an unknown table, so there is nothing
 * to correct for afterwards (doc 11 §11.8).
 *
 * The engine therefore records what *took effect*, not what was asked for, and the confidence
 * model prices the difference in (doc 15 §15.2, C4). Exactly how each browser signals a refusal
 * is an open verification item (**EV-010**); this implementation handles the three shapes seen
 * in the wild — a rejected promise, a thrown synchronous error, and a silent downgrade — and
 * treats anything it cannot confirm as *not* effective. Assuming success would silently
 * overstate the quality of every session on an unsupported browser.
 *
 * ## Coalesced events
 *
 * A pointer event delivered on a frame boundary can carry many samples that occurred between
 * frames. `getCoalescedEvents()` returns all of them, with their own timestamps, so a 1000 Hz
 * mouse contributes 1000 integration steps per second rather than one per frame.
 */

/** Minimal shape of the pointer-lock options bag, which older DOM lib versions omit. */
interface PointerLockOptions {
  unadjustedMovement?: boolean;
}

type LockableElement = HTMLElement & {
  requestPointerLock(options?: PointerLockOptions): Promise<void> | undefined;
};

export interface PointerLockInputOptions {
  /** The element that receives pointer lock. Normally the canvas. */
  readonly element: HTMLElement;
  /** Document to observe for lock, visibility and focus changes. */
  readonly document?: Document;
  /** Window to observe for blur and DPR changes. */
  readonly window?: Window;
  /** Whether to request unadjusted movement. Off only for the degradation probe. */
  readonly requestUnadjustedMovement?: boolean;
}

export function createPointerLockInput(options: PointerLockInputOptions): InputSource {
  const element = options.element as LockableElement;
  const doc = options.document ?? element.ownerDocument;
  const view = options.window ?? doc.defaultView;
  const wantsUnadjusted = options.requestUnadjustedMovement ?? true;

  let sink: InputSink | null = null;
  let unadjustedEffective = false;
  let devicePixelRatio = view?.devicePixelRatio ?? 1;
  let lastWidth = element.clientWidth;
  let lastHeight = element.clientHeight;
  let resizeObserver: ResizeObserver | null = null;

  const isLocked = (): boolean => doc.pointerLockElement === element;

  const emitMove = (event: PointerEvent | MouseEvent): void => {
    if (sink === null || !isLocked()) return;

    const withCoalesced = event as PointerEvent & {
      getCoalescedEvents?: () => PointerEvent[];
    };

    // Coalesced events carry the sub-frame samples. When unavailable, the event itself is the
    // only sample there is.
    const samples =
      typeof withCoalesced.getCoalescedEvents === "function"
        ? withCoalesced.getCoalescedEvents()
        : [];

    if (samples.length === 0) {
      sink.onMove(toSample(event));
      return;
    }

    for (const sample of samples) sink.onMove(toSample(sample));
  };

  const toSample = (event: PointerEvent | MouseEvent): MovementSample => ({
    // `timeStamp` shares the origin-relative epoch with performance.now() in every browser on
    // the support matrix. A zero timestamp means the event was synthesised without one, in
    // which case the current time is the best available answer.
    t: event.timeStamp > 0 ? event.timeStamp : performance.now(),
    dx: event.movementX,
    dy: event.movementY,
  });

  const toButton = (event: MouseEvent, phase: ButtonEvent["phase"]): ButtonEvent => ({
    t: event.timeStamp > 0 ? event.timeStamp : performance.now(),
    button: event.button,
    phase,
  });

  const onPointerMove = (event: Event): void => emitMove(event as PointerEvent);

  const onMouseDown = (event: Event): void => {
    if (sink === null || !isLocked()) return;
    sink.onButton(toButton(event as MouseEvent, "down"));
  };

  const onMouseUp = (event: Event): void => {
    if (sink === null || !isLocked()) return;
    sink.onButton(toButton(event as MouseEvent, "up"));
  };

  const onLockChange = (): void => {
    const locked = isLocked();
    if (!locked) unadjustedEffective = false;
    sink?.onLockChange(locked);
  };

  const onLockError = (): void => {
    unadjustedEffective = false;
    sink?.onLockChange(false);
  };

  const onVisibility = (): void => {
    sink?.onFocusChange(doc.visibilityState === "visible");
  };

  const onBlur = (): void => sink?.onFocusChange(false);
  const onFocus = (): void => sink?.onFocusChange(doc.visibilityState === "visible");

  const onKeyDown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    sink?.onKey(
      keyboardEvent.key,
      keyboardEvent.timeStamp > 0 ? keyboardEvent.timeStamp : performance.now(),
    );
  };

  const checkDevicePixelRatio = (): void => {
    const current = view?.devicePixelRatio ?? 1;
    if (current !== devicePixelRatio) {
      devicePixelRatio = current;
      // Moving a window between displays changes the angular-to-pixel mapping, so the session
      // is no longer internally comparable (doc 19 §19.5).
      sink?.onSurfaceChange("device_pixel_ratio");
    }
  };

  return {
    get state(): InputSourceState {
      return {
        locked: isLocked(),
        unadjustedMovementEffective: unadjustedEffective,
        focused: doc.visibilityState === "visible",
      };
    },

    attach(next: InputSink): void {
      sink = next;
      doc.addEventListener("pointermove", onPointerMove, { passive: true });
      doc.addEventListener("mousedown", onMouseDown);
      doc.addEventListener("mouseup", onMouseUp);
      doc.addEventListener("pointerlockchange", onLockChange);
      doc.addEventListener("pointerlockerror", onLockError);
      doc.addEventListener("visibilitychange", onVisibility);
      doc.addEventListener("keydown", onKeyDown);
      view?.addEventListener("blur", onBlur);
      view?.addEventListener("focus", onFocus);

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          if (element.clientWidth !== lastWidth || element.clientHeight !== lastHeight) {
            lastWidth = element.clientWidth;
            lastHeight = element.clientHeight;
            sink?.onSurfaceChange("resize");
          }
          checkDevicePixelRatio();
        });
        resizeObserver.observe(element);
      }
    },

    detach(): void {
      doc.removeEventListener("pointermove", onPointerMove);
      doc.removeEventListener("mousedown", onMouseDown);
      doc.removeEventListener("mouseup", onMouseUp);
      doc.removeEventListener("pointerlockchange", onLockChange);
      doc.removeEventListener("pointerlockerror", onLockError);
      doc.removeEventListener("visibilitychange", onVisibility);
      doc.removeEventListener("keydown", onKeyDown);
      view?.removeEventListener("blur", onBlur);
      view?.removeEventListener("focus", onFocus);
      resizeObserver?.disconnect();
      resizeObserver = null;
      sink = null;
    },

    async requestLock(): Promise<LockOutcome> {
      if (typeof element.requestPointerLock !== "function") {
        return {
          locked: false,
          unadjustedMovementRequested: false,
          unadjustedMovementEffective: false,
          failureReason: "pointer_lock_unsupported",
        };
      }

      if (wantsUnadjusted) {
        try {
          const result = element.requestPointerLock({ unadjustedMovement: true });
          // Browsers that support the options bag return a promise; older ones return
          // undefined and ignore the option entirely.
          if (result !== undefined) {
            await result;
            unadjustedEffective = isLocked();
            return {
              locked: isLocked(),
              unadjustedMovementRequested: true,
              unadjustedMovementEffective: unadjustedEffective,
            };
          }
          // Silent downgrade: the lock may succeed, but nothing confirms the option took
          // effect, so it is reported as not effective rather than assumed (EV-010).
          unadjustedEffective = false;
        } catch (error: unknown) {
          unadjustedEffective = false;
          const reason = error instanceof Error ? error.name : "unknown";
          // Fall through to a plain request: a refusal of the *option* must not cost the user
          // their calibration, it must cost the session some confidence.
          const plain = await requestPlain(element);
          return {
            locked: plain,
            unadjustedMovementRequested: true,
            unadjustedMovementEffective: false,
            ...(plain ? {} : { failureReason: reason }),
          };
        }
      }

      const locked = await requestPlain(element);
      return {
        locked,
        unadjustedMovementRequested: wantsUnadjusted,
        unadjustedMovementEffective: false,
        ...(locked ? {} : { failureReason: "lock_denied" }),
      };
    },

    releaseLock(): void {
      if (isLocked()) doc.exitPointerLock();
    },
  };
}

async function requestPlain(element: LockableElement): Promise<boolean> {
  try {
    const result = element.requestPointerLock();
    if (result !== undefined) await result;
    return element.ownerDocument.pointerLockElement === element;
  } catch {
    return false;
  }
}

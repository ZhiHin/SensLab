/**
 * The engine clock (doc 19 §19.1 principle 3, `SENS-NFR-006`).
 *
 * Every timestamp in a measurement comes from a monotonic high-resolution source, never from
 * wall time: wall time can step backwards across an NTP correction, and a trial that appears
 * to have taken -4 ms is a data point nobody can interpret.
 *
 * The clock is an interface rather than a direct `performance.now()` call so that the headless
 * harness can drive time exactly (doc 19 §19.12). That is not a testing convenience bolted on
 * afterwards — it is the only way to assert frame-rate independence, because you cannot ask a
 * real browser to deliver a frame exactly 6.94 ms late.
 */

export type FrameCallback = (timestampMs: number) => void;

export interface Clock {
  /** Monotonic time in milliseconds, sub-millisecond resolution. */
  now(): number;
  /** Schedules a callback for the next frame. Returns a handle for cancellation. */
  scheduleFrame(callback: FrameCallback): number;
  cancelFrame(handle: number): void;
}

/** The production clock: `performance.now()` and `requestAnimationFrame`. */
export function createBrowserClock(): Clock {
  return {
    now: () => performance.now(),
    scheduleFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => {
      cancelAnimationFrame(handle);
    },
  };
}

/**
 * A clock the test drives by hand.
 *
 * Time advances only when `advance()` is called, and frames fire only when the caller says
 * so — which is what makes it possible to assert that a 60 Hz player and a 240 Hz player get
 * identical hit decisions for identical input.
 */
export interface ScriptedClock extends Clock {
  /** Moves time forward without firing a frame. */
  advance(deltaMs: number): void;
  /**
   * Moves time forward and fires exactly one scheduled frame at the new timestamp.
   * Returns false when nothing was scheduled.
   */
  tick(deltaMs: number): boolean;
  /** Fires frames at a fixed interval for a total duration. */
  run(totalMs: number, frameIntervalMs: number): void;
  set(timestampMs: number): void;
  readonly pendingFrames: number;
}

export function createScriptedClock(startMs = 0): ScriptedClock {
  let current = startMs;
  let nextHandle = 1;
  const scheduled = new Map<number, FrameCallback>();

  const fireOne = (): boolean => {
    const entry = scheduled.entries().next();
    if (entry.done === true) return false;
    const [handle, callback] = entry.value;
    scheduled.delete(handle);
    callback(current);
    return true;
  };

  return {
    now: () => current,
    scheduleFrame: (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      scheduled.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      scheduled.delete(handle);
    },
    advance: (deltaMs) => {
      current += deltaMs;
    },
    tick: (deltaMs) => {
      current += deltaMs;
      return fireOne();
    },
    run: (totalMs, frameIntervalMs) => {
      if (frameIntervalMs <= 0) {
        throw new RangeError("run() requires a positive frame interval");
      }
      const end = current + totalMs;
      while (current + frameIntervalMs <= end) {
        current += frameIntervalMs;
        if (!fireOne()) break;
      }
    },
    set: (timestampMs) => {
      current = timestampMs;
    },
    get pendingFrames() {
      return scheduled.size;
    },
  };
}

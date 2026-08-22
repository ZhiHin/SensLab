/**
 * Frame-quality monitoring (doc 19 §19.10, doc 30 §30.3).
 *
 * The monitor **classifies; it never modifies a measurement**. Keeping classification separate
 * from measurement is what makes `SENS-BR-009` enforceable: the engine can mark a trial
 * degraded or invalid because the *environment* misbehaved, and there is no code path by which
 * it could do so because the *player* did badly.
 *
 * A stutter that goes unrecorded is worse than one that is recorded, because a recommendation
 * built on a stuttering session is not comparable to one built on a clean session, and nothing
 * downstream can tell the difference after the fact (`SENS-BR-010`).
 */

export interface FrameThresholds {
  /** A frame is "late" beyond this multiple of the display's frame interval. */
  readonly lateFrameFactor: number;
  /** A single gap this long inside a measured window invalidates the trial. */
  readonly hitchMs: number;
  /** Late-frame ratio above which a trial is marked `degraded`. */
  readonly degradedTrialRatio: number;
  /** Fraction of degraded trials above which a round is flagged. */
  readonly degradedRoundRatio: number;
  /** Session-wide clean-frame fraction below which the quality warning is raised. */
  readonly sessionWarningCleanFraction: number;
}

/** doc 30 §30.3. Tunable, but these are the documented v1 values. */
export const DEFAULT_FRAME_THRESHOLDS: FrameThresholds = {
  lateFrameFactor: 1.25,
  hitchMs: 100,
  degradedTrialRatio: 0.08,
  degradedRoundRatio: 0.2,
  sessionWarningCleanFraction: 0.9,
};

export interface FrameWindowStats {
  readonly frames: number;
  readonly lateFrames: number;
  readonly hitches: number;
  readonly cleanFrameFraction: number;
  readonly meanIntervalMs: number;
  readonly maxIntervalMs: number;
  readonly p95IntervalMs: number;
}

export const EMPTY_WINDOW: FrameWindowStats = {
  frames: 0,
  lateFrames: 0,
  hitches: 0,
  // No frames observed is not evidence of poor quality; it is no evidence at all.
  cleanFrameFraction: 1,
  meanIntervalMs: 0,
  maxIntervalMs: 0,
  p95IntervalMs: 0,
};

export interface FrameMonitor {
  /** Records one frame boundary. Returns the interval since the previous frame. */
  record(timestampMs: number): number;
  /** Begins a measured window (a trial). Intervals before this are not attributed to it. */
  openWindow(): void;
  /** Closes the window and returns its statistics. */
  closeWindow(): FrameWindowStats;
  /** Statistics for the window currently open. */
  peekWindow(): FrameWindowStats;
  /** Whether the open window has seen a hitch — the invalidating condition. */
  windowHasHitch(): boolean;
  /** Session-wide statistics across every frame recorded. */
  sessionStats(): FrameWindowStats;
  /** Refreshes the assumed display interval once the environment check has measured it. */
  setFrameBudgetMs(budgetMs: number): void;
  readonly frameBudgetMs: number;
}

interface Accumulator {
  frames: number;
  lateFrames: number;
  hitches: number;
  totalMs: number;
  maxMs: number;
  intervals: number[];
}

const newAccumulator = (): Accumulator => ({
  frames: 0,
  lateFrames: 0,
  hitches: 0,
  totalMs: 0,
  maxMs: 0,
  intervals: [],
});

function summarise(accumulator: Accumulator): FrameWindowStats {
  if (accumulator.frames === 0) return EMPTY_WINDOW;

  const sorted = [...accumulator.intervals].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)));

  return {
    frames: accumulator.frames,
    lateFrames: accumulator.lateFrames,
    hitches: accumulator.hitches,
    cleanFrameFraction: (accumulator.frames - accumulator.lateFrames) / accumulator.frames,
    meanIntervalMs: accumulator.totalMs / accumulator.frames,
    maxIntervalMs: accumulator.maxMs,
    p95IntervalMs: sorted[index] ?? 0,
  };
}

export interface FrameMonitorOptions {
  /** Display frame interval in ms. 60 Hz until the environment check measures the real one. */
  readonly frameBudgetMs?: number;
  readonly thresholds?: FrameThresholds;
  /**
   * Cap on retained interval samples per accumulator, for the p95 estimate.
   * Bounded so that a long session cannot grow this array without limit.
   */
  readonly maxRetainedIntervals?: number;
}

export function createFrameMonitor(options: FrameMonitorOptions = {}): FrameMonitor {
  const thresholds = options.thresholds ?? DEFAULT_FRAME_THRESHOLDS;
  const maxRetained = options.maxRetainedIntervals ?? 4096;

  let budgetMs = options.frameBudgetMs ?? 1000 / 60;
  let previousTimestamp: number | null = null;
  // Named `openWindow` rather than `window`: shadowing a browser global in a file that must
  // never touch one makes both the code and the architecture scan harder to read.
  let openWindow: Accumulator | null = null;
  const session = newAccumulator();

  const attribute = (
    accumulator: Accumulator,
    intervalMs: number,
    late: boolean,
    hitch: boolean,
  ) => {
    accumulator.frames += 1;
    accumulator.totalMs += intervalMs;
    if (intervalMs > accumulator.maxMs) accumulator.maxMs = intervalMs;
    if (late) accumulator.lateFrames += 1;
    if (hitch) accumulator.hitches += 1;
    // Reservoir-free bound: once full, keep the earliest samples. The p95 is a diagnostic,
    // not a measurement, and an unbounded array in a 40-minute session is a real cost.
    if (accumulator.intervals.length < maxRetained) accumulator.intervals.push(intervalMs);
  };

  return {
    get frameBudgetMs() {
      return budgetMs;
    },

    setFrameBudgetMs(next: number): void {
      if (!Number.isFinite(next) || next <= 0) {
        throw new RangeError(`frame budget must be positive, received ${next}`);
      }
      budgetMs = next;
    },

    record(timestampMs: number): number {
      if (previousTimestamp === null) {
        previousTimestamp = timestampMs;
        return 0;
      }

      const intervalMs = timestampMs - previousTimestamp;
      previousTimestamp = timestampMs;
      // A non-positive interval means the caller replayed or reordered timestamps. Attributing
      // it would corrupt the statistics, so it is dropped rather than counted as a fast frame.
      if (intervalMs <= 0) return intervalMs;

      const late = intervalMs > budgetMs * thresholds.lateFrameFactor;
      const hitch = intervalMs > thresholds.hitchMs;

      attribute(session, intervalMs, late, hitch);
      if (openWindow !== null) attribute(openWindow, intervalMs, late, hitch);

      return intervalMs;
    },

    openWindow(): void {
      openWindow = newAccumulator();
    },

    closeWindow(): FrameWindowStats {
      const stats = openWindow === null ? EMPTY_WINDOW : summarise(openWindow);
      openWindow = null;
      return stats;
    },

    peekWindow(): FrameWindowStats {
      return openWindow === null ? EMPTY_WINDOW : summarise(openWindow);
    },

    windowHasHitch(): boolean {
      return openWindow !== null && openWindow.hitches > 0;
    },

    sessionStats(): FrameWindowStats {
      return summarise(session);
    },
  };
}

/** Whether a completed trial's frame statistics warrant the `degraded` classification. */
export function isDegraded(
  stats: FrameWindowStats,
  thresholds: FrameThresholds = DEFAULT_FRAME_THRESHOLDS,
): boolean {
  if (stats.frames === 0) return false;
  return 1 - stats.cleanFrameFraction > thresholds.degradedTrialRatio;
}

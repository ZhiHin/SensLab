import { countsPer360 } from "@/core/types/brand";
import type {
  MotionPattern,
  PlannedRound,
  SessionPlan,
  TargetSpec,
  TestDefinition,
  TestRng,
  TrialContext,
} from "@/test-engine/contracts";
import type {
  InputSink,
  InputSource,
  InputSourceState,
  LockOutcome,
} from "@/test-engine/input/types";
import type { Renderer } from "@/test-engine/render/renderer";
import { createScriptedClock, type ScriptedClock } from "@/test-engine/timing/clock";

/**
 * The headless deterministic harness (doc 19 §19.12).
 *
 * This is where the majority of the engine's tests live, and it is the reason the clock and the
 * input source are injected rather than read from the DOM. A scripted trace with exact
 * timestamps lets a test assert the exact trial record the engine produced — including things a
 * real browser cannot be asked to do on demand, like delivering a frame precisely 140 ms late,
 * or feeding the same input at 60 Hz and 240 Hz to prove the hit decision is identical.
 *
 * Everything here is a *test double*, not a stub standing in for missing production code: the
 * engine under test is the real engine, drawing through a null renderer.
 */

/* ------------------------------------------------------------------ scripted input */

export interface ScriptedInput extends InputSource {
  /** Feeds one movement sample. */
  move(t: number, dx: number, dy: number): void;
  /** Feeds a press and a release, `holdMs` apart. */
  click(t: number, holdMs?: number): void;
  press(t: number, button?: number): void;
  release(t: number, button?: number): void;
  losePointerLock(): void;
  loseFocus(): void;
  changeSurface(reason: "resize" | "device_pixel_ratio"): void;
  key(key: string, t: number): void;
  /** Controls what the next `requestLock()` reports. */
  setLockOutcome(outcome: Partial<LockOutcome>): void;
  readonly lockRequests: number;
}

export function createScriptedInput(): ScriptedInput {
  let sink: InputSink | null = null;
  let locked = false;
  let lockRequests = 0;
  let outcome: LockOutcome = {
    locked: true,
    unadjustedMovementRequested: true,
    unadjustedMovementEffective: true,
  };

  return {
    get state(): InputSourceState {
      return {
        locked,
        unadjustedMovementEffective: outcome.unadjustedMovementEffective,
        focused: true,
      };
    },
    get lockRequests() {
      return lockRequests;
    },

    attach(next: InputSink): void {
      sink = next;
    },
    detach(): void {
      sink = null;
    },

    async requestLock(): Promise<LockOutcome> {
      lockRequests += 1;
      locked = outcome.locked;
      return outcome;
    },

    releaseLock(): void {
      locked = false;
    },

    setLockOutcome(next: Partial<LockOutcome>): void {
      outcome = { ...outcome, ...next };
    },

    move(t, dx, dy): void {
      sink?.onMove({ t, dx, dy });
    },

    press(t, button = 0): void {
      sink?.onButton({ t, button, phase: "down" });
    },

    release(t, button = 0): void {
      sink?.onButton({ t, button, phase: "up" });
    },

    click(t, holdMs = 8): void {
      sink?.onButton({ t, button: 0, phase: "down" });
      sink?.onButton({ t: t + holdMs, button: 0, phase: "up" });
    },

    losePointerLock(): void {
      locked = false;
      sink?.onLockChange(false);
    },

    loseFocus(): void {
      sink?.onFocusChange(false);
    },

    changeSurface(reason): void {
      sink?.onSurfaceChange(reason);
    },

    key(key, t): void {
      sink?.onKey(key, t);
    },
  };
}

/* ------------------------------------------------------------------ synthetic definitions */

export interface SyntheticDefinitionOptions {
  readonly key?: string;
  readonly endCondition?: TestDefinition["endCondition"];
  readonly shootingModel?: TestDefinition["shootingModel"];
  readonly timeoutMs?: number;
  readonly interTrialIntervalMs?: { readonly min: number; readonly max: number };
  readonly targetDistanceDeg?: number;
  readonly targetRadiusDeg?: number;
  readonly includeResetTarget?: boolean;
  readonly motion?: MotionPattern;
  readonly killTarget?: number;
  readonly targetCount?: number;
  readonly metricKeys?: readonly string[];
  readonly minMovementCounts?: number;
  readonly minHeldRatio?: number;
  readonly trialCount?: number;
}

/**
 * A test definition that exists only for the harness.
 *
 * FR-058's acceptance criterion is that a synthetic definition runs end to end without any
 * engine change (doc 19 §19.9). This is that definition: if the engine ever needs a special
 * case to run it, the claim that "a test is data" has stopped being true.
 *
 * Targets are placed deterministically rather than randomly, so a test can compute exactly
 * where to aim.
 */
export function createSyntheticDefinition(
  options: SyntheticDefinitionOptions = {},
): TestDefinition {
  const distance = options.targetDistanceDeg ?? 20;
  const radius = options.targetRadiusDeg ?? 2;
  const count = options.targetCount ?? 1;

  return {
    // `flick` is a real key so the definition can be persisted through the ingest path; its
    // behaviour here is the harness's, not the Phase 3 flick test's.
    key: (options.key ?? "flick") as TestDefinition["key"],
    version: 1,
    category: "scored",
    instructionsKey: "test.synthetic.instructions",
    displayNameKey: "test.synthetic.name",

    trialCount: () => options.trialCount ?? 3,
    minValidTrials: () => 1,
    practiceTrialCount: () => 0,

    timeoutMs: options.timeoutMs ?? 2000,
    interTrialIntervalMs: options.interTrialIntervalMs ?? { min: 100, max: 100 },
    endCondition: options.endCondition ?? "first_hit",
    shootingModel: options.shootingModel ?? "click",
    ...(options.killTarget === undefined ? {} : { killTarget: options.killTarget }),
    ...(options.minMovementCounts === undefined
      ? {}
      : { minMovementCounts: options.minMovementCounts }),
    ...(options.minHeldRatio === undefined ? {} : { minHeldRatio: options.minHeldRatio }),

    spawn(_rng: TestRng, _context: TrialContext): readonly TargetSpec[] {
      const specs: TargetSpec[] = [];
      if (options.includeResetTarget === true) {
        specs.push({ yawDeg: 0, pitchDeg: 0, angularRadiusDeg: 3, role: "reset" });
      }
      for (let index = 0; index < count; index += 1) {
        specs.push({
          yawDeg: distance + index * (radius * 4),
          pitchDeg: 0,
          angularRadiusDeg: radius,
          role: "scored",
        });
      }
      return specs;
    },

    motionFor(): MotionPattern {
      return options.motion ?? { kind: "static" };
    },

    additionalInvalidReasons: [],
    metricKeys: options.metricKeys ?? [],
  };
}

/* ------------------------------------------------------------------ plans */

export interface PlanOptions {
  readonly rounds?: readonly Partial<PlannedRound>[];
  readonly candidateCounts?: readonly number[];
  readonly baselineCountsPer360?: number;
  readonly freeAim?: SessionPlan["freeAim"];
  readonly seed?: string;
  readonly maxImpliedCountsPerSecond?: number;
}

export function createPlan(options: PlanOptions = {}): SessionPlan {
  const counts = options.candidateCounts ?? [9448.82];

  const rounds: PlannedRound[] = (options.rounds ?? [{}]).map((partial, index) => ({
    presentationOrder: partial.presentationOrder ?? index,
    blockIndex: partial.blockIndex ?? index,
    roundIndex: partial.roundIndex ?? 0,
    // `?? 0` would collapse an explicit null — the very thing a candidate-free round declares.
    candidateIndex: partial.candidateIndex === undefined ? 0 : partial.candidateIndex,
    testKey: partial.testKey ?? "flick",
    scopeKey: partial.scopeKey ?? "hipfire",
    isPractice: partial.isPractice ?? false,
    trialCount: partial.trialCount ?? 2,
    stimulusSeed: partial.stimulusSeed ?? `stimulus-${index}`,
  }));

  return {
    sessionId: "00000000-0000-7000-8000-000000000000",
    mode: "standard",
    seed: options.seed ?? "harness-seed",
    fovHorizontalHalfDeg: 51.5,
    aspectRatio: 16 / 9,
    candidates: counts.map((value, index) => ({
      candidateIndex: index,
      countsPer360: countsPer360(value),
      blindLabel: String.fromCharCode(65 + index),
    })),
    rounds,
    testConfigVersion: "1.0.0",
    baselineCountsPer360: countsPer360(options.baselineCountsPer360 ?? 9448.82),
    maxImpliedCountsPerSecond: options.maxImpliedCountsPerSecond ?? 4_000_000,
    ...(options.freeAim === undefined ? {} : { freeAim: options.freeAim }),
  };
}

/* ------------------------------------------------------------------ recording renderer */

/** Exactly the argument the engine hands its renderer each frame. */
export type DrawInput = Parameters<Renderer["draw"]>[0];

export interface RecordingRenderer extends Renderer {
  /** Frames drawn since construction. */
  readonly drawCount: number;
  /** The most recent frame's draw input, or null before the first frame. */
  readonly lastFrame: DrawInput | null;
}

/**
 * A renderer that draws nothing and remembers the last frame.
 *
 * This is how a test sees what the player would see. It matters that it goes through the
 * renderer seam rather than reaching into the engine: a driver that aims at a target the
 * renderer never drew would be testing an engine nobody can play.
 */
export function createRecordingRenderer(cssWidth = 1920, cssHeight = 1080): RecordingRenderer {
  let width = cssWidth;
  let height = cssHeight;
  let drawCount = 0;
  let lastFrame: DrawInput | null = null;

  return {
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    get drawCount() {
      return drawCount;
    },
    get lastFrame() {
      return lastFrame;
    },

    resize(nextWidth: number, nextHeight: number): void {
      width = nextWidth;
      height = nextHeight;
    },

    draw(input: DrawInput): void {
      drawCount += 1;
      lastFrame = input;
    },
  };
}

/* ------------------------------------------------------------------ driving */

export interface Harness {
  readonly clock: ScriptedClock;
  readonly input: ScriptedInput;
  readonly renderer: RecordingRenderer;
}

export function createHarness(startMs = 1000): Harness {
  return {
    clock: createScriptedClock(startMs),
    input: createScriptedInput(),
    renderer: createRecordingRenderer(),
  };
}

/**
 * Runs frames at a fixed interval, letting a callback act between them.
 *
 * The callback receives the timestamp *after* the frame, which is when a test would inject
 * movement or a click for the next interval.
 */
export function runFrames(
  clock: ScriptedClock,
  frames: number,
  intervalMs: number,
  between?: (now: number, index: number) => void,
): void {
  for (let index = 0; index < frames; index += 1) {
    clock.tick(intervalMs);
    between?.(clock.now(), index);
  }
}

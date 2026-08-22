"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoundAggregate, SessionPlan, TestDefinition } from "./contracts";
import { createEngine, type Engine, type EngineState } from "./engine";
import { createPointerLockInput } from "./input/pointer-lock";
import { coloursFromDocument, createRenderer } from "./render/renderer";
import type { PauseReason, SessionStage } from "./session-controller";
import { createBrowserClock } from "./timing/clock";
import type { SessionQualityFlag } from "../core/types/vocabulary";

/**
 * The React boundary (doc 19 §19.11, ADR-020).
 *
 * **This is the only React-aware file in the engine**, and the only one permitted to import
 * React at all — an architecture test enforces that. Everything below the canvas runs outside
 * React's world entirely: no hooks, no state, no reconciliation, no scheduler.
 *
 * ## What crosses the boundary, and when
 *
 * React learns about the session at **stage boundaries only** — a round finished, the session
 * paused, the session ended. It never learns about a frame or a trial. That is not a
 * performance preference; a React render inside a measured window is a variable-cost pause in
 * the middle of a latency measurement, and `SENS-NFR-004` forbids it.
 *
 * The consequence is visible in the code: the HUD is drawn on the canvas, not in the DOM, and
 * the `status` state below changes a handful of times per session rather than 240 times per
 * second. The pause overlay *is* DOM, because it only exists while paused — when nothing is
 * being measured.
 *
 * ## Ownership
 *
 * React owns the page; the engine owns the canvas. React hands the engine a plan and a set of
 * definitions and then keeps out of the way until the engine reports something worth a render.
 */

export interface UseAimEngineOptions {
  readonly plan: SessionPlan;
  readonly definitions: readonly TestDefinition[];
  /** Called once per round, never per trial. */
  onRoundComplete?(aggregate: RoundAggregate): void;
  onFinished?(): void;
  onAborted?(): void;
  onQualityWarning?(flags: readonly SessionQualityFlag[]): void;
  /** Measured display interval from the environment check, when one has run. */
  readonly frameBudgetMs?: number;
  readonly maxPollingRateHz?: number;
}

export interface AimEngineHandle {
  /**
   * Attach to the canvas element the engine should own.
   *
   * A callback ref rather than a ref object: the engine is built when the canvas actually
   * attaches, which is also when its size is known, and torn down when it detaches.
   */
  readonly attachCanvas: (element: HTMLCanvasElement | null) => void;
  readonly state: EngineState;
  /** Coarse stage, updated at stage boundaries only. */
  readonly stage: SessionStage;
  readonly pauseReason: PauseReason | null;
  readonly qualityFlags: readonly SessionQualityFlag[];
  /** Whether the free-aim warm-up minimum has been met. */
  readonly freeAimSatisfied: boolean;

  /** Must be called from a user gesture: pointer lock requires one. */
  start(): Promise<boolean>;
  resume(): Promise<boolean>;
  pause(): void;
  restartRound(): void;
  abort(): void;
  completeFreeAim(): void;
}

const IDLE_STAGE: SessionStage = { kind: "idle" };

export function useAimEngine(options: UseAimEngineOptions): AimEngineHandle {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const attachCanvas = useCallback((element: HTMLCanvasElement | null): void => {
    setCanvas(element);
  }, []);
  const engineRef = useRef<Engine | null>(null);

  // Callbacks live in a ref so that a parent re-rendering with new closures does not tear down
  // and rebuild a running engine mid-session. The ref is written in an effect rather than
  // during render, so a render that React later discards cannot leave a stale closure behind.
  const callbacksRef = useRef(options);
  useEffect(() => {
    callbacksRef.current = options;
  });

  const [state, setState] = useState<EngineState>("idle");
  const [stage, setStage] = useState<SessionStage>(IDLE_STAGE);
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null);
  const [qualityFlags, setQualityFlags] = useState<readonly SessionQualityFlag[]>([]);

  const { plan, definitions, frameBudgetMs, maxPollingRateHz } = options;

  useEffect(() => {
    if (canvas === null) return;

    const context = canvas.getContext("2d", { alpha: false });
    const rect = canvas.getBoundingClientRect();

    const engine = createEngine({
      plan,
      definitions,
      clock: createBrowserClock(),
      input: createPointerLockInput({ element: canvas }),
      renderer: createRenderer({
        context,
        cssWidth: rect.width,
        cssHeight: rect.height,
        devicePixelRatio: window.devicePixelRatio,
        colours: coloursFromDocument(document.documentElement),
      }),
      ...(frameBudgetMs === undefined ? {} : { frameBudgetMs }),
      ...(maxPollingRateHz === undefined ? {} : { maxPollingRateHz }),
      callbacks: {
        // Every one of these fires at a stage boundary. None fires per frame or per trial.
        onStageChange: (next) => {
          setStage(next);
          setState(engine.state);
          if (next.kind === "paused") setPauseReason(next.reason);
          else if (next.kind === "round") setPauseReason(null);
        },
        onRoundComplete: (aggregate) => callbacksRef.current.onRoundComplete?.(aggregate),
        onPaused: (reason) => {
          setPauseReason(reason);
          setState("paused");
        },
        onFinished: () => {
          setState("finished");
          callbacksRef.current.onFinished?.();
        },
        onAborted: () => {
          setState("aborted");
          callbacksRef.current.onAborted?.();
        },
        onQualityWarning: (flags) => {
          setQualityFlags(flags);
          callbacksRef.current.onQualityWarning?.(flags);
        },
      },
    });

    engine.init();
    engineRef.current = engine;
    setState(engine.state);

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [canvas, plan, definitions, frameBudgetMs, maxPollingRateHz]);

  const start = useCallback(async (): Promise<boolean> => {
    const engine = engineRef.current;
    if (engine === null) return false;
    const started = await engine.start();
    setState(engine.state);
    return started;
  }, []);

  const resume = useCallback(async (): Promise<boolean> => {
    const engine = engineRef.current;
    if (engine === null) return false;
    const resumed = await engine.resume();
    setState(engine.state);
    return resumed;
  }, []);

  const pause = useCallback((): void => {
    engineRef.current?.pause("user");
  }, []);

  const restartRound = useCallback((): void => {
    const engine = engineRef.current;
    if (engine === null) return;
    engine.restartRound();
    setState(engine.state);
  }, []);

  const abort = useCallback((): void => {
    engineRef.current?.abort();
  }, []);

  const completeFreeAim = useCallback((): void => {
    engineRef.current?.completeFreeAim();
  }, []);

  return {
    attachCanvas,
    state,
    stage,
    pauseReason,
    qualityFlags,
    // Derived from the stage rather than read off the engine: the stage is state, so the
    // "Continue" control re-enables on the acquisition that satisfies the minimum. Reading the
    // engine during render would give an answer React never re-checks.
    freeAimSatisfied:
      stage.kind !== "free_aim" || stage.acquisitions >= (plan.freeAim?.minAcquisitions ?? 0),
    start,
    resume,
    pause,
    restartRound,
    abort,
    completeFreeAim,
  };
}

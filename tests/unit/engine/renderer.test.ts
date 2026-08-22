import { afterEach, describe, expect, it, vi } from "vitest";
import { countsPer360FromCm, degreesPerCount } from "@/core/sensitivity/canonical";
import { createCamera } from "@/test-engine/render/camera";
import { buildHudModel } from "@/test-engine/render/hud";
import {
  coloursFromDocument,
  createRenderer,
  DEFAULT_COLOURS,
  FEEDBACK_LIFETIME_MS,
  type RenderFeedback,
} from "@/test-engine/render/renderer";
import { createTargetManager } from "@/test-engine/targets/target-manager";

/**
 * The Canvas 2D renderer (ADR-005, doc 19 §19.13, `SENS-BR-021`).
 *
 * The renderer is allowed to draw exactly six things, and the restriction is the point: at
 * fewer than ten simple shapes Canvas 2D sits an order of magnitude under the frame budget and
 * paces more predictably than WebGL. A gradient or a shadow added later would not look wrong —
 * it would quietly cost frames inside a latency measurement, which is the one failure this
 * product cannot detect after the fact.
 *
 * The context is a recording double. Every call the renderer makes is a real Canvas 2D call;
 * only the rasteriser is absent.
 */

interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

interface RecordingContext {
  readonly calls: RecordedCall[];
  readonly assignments: Record<string, unknown[]>;
  readonly context: CanvasRenderingContext2D;
  names(): string[];
}

/** Canvas 2D methods a renderer could reach for. Anything outside this set throws. */
const METHODS = [
  "setTransform",
  "fillRect",
  "clearRect",
  "beginPath",
  "arc",
  "moveTo",
  "lineTo",
  "stroke",
  "fill",
  "fillText",
  "save",
  "restore",
  "measureText",
] as const;

/** Effects the renderer is forbidden to use without an ADR and a frame measurement. */
const FORBIDDEN = [
  "createLinearGradient",
  "createRadialGradient",
  "createPattern",
  "shadowBlur",
  "shadowColor",
  "filter",
  "globalCompositeOperation",
  "drawImage",
  "ellipse",
  "roundRect",
] as const;

function createRecordingContext(): RecordingContext {
  const calls: RecordedCall[] = [];
  const assignments: Record<string, unknown[]> = {};
  const canvas = { width: 0, height: 0 };

  const target: Record<string, unknown> = { canvas };
  for (const name of METHODS) {
    target[name] = (...args: unknown[]) => {
      calls.push({ name, args });
      return name === "measureText" ? { width: 40 } : undefined;
    };
  }

  const context = new Proxy(target, {
    get(base, property: string) {
      if ((FORBIDDEN as readonly string[]).includes(property)) {
        throw new Error(`the renderer may not use "${property}" (ADR-005)`);
      }
      return base[property];
    },
    set(base, property: string, value: unknown) {
      if ((FORBIDDEN as readonly string[]).includes(property)) {
        throw new Error(`the renderer may not set "${property}" (ADR-005)`);
      }
      (assignments[property] ??= []).push(value);
      base[property] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return {
    calls,
    assignments,
    context,
    names: () => calls.map((call) => call.name),
  };
}

const DEG_PER_COUNT = degreesPerCount(countsPer360FromCm(30, 800));

const makeCamera = () =>
  createCamera({
    horizontalHalfFovDeg: 51.5,
    aspectRatio: 16 / 9,
    degreesPerCount: DEG_PER_COUNT,
  });

const IDLE_HUD = buildHudModel({ kind: "idle" }, { completedRounds: 0, totalRounds: 4 }, 0);

const ROUND_HUD = buildHudModel(
  {
    kind: "round",
    round: {
      presentationOrder: 0,
      blockIndex: 0,
      roundIndex: 1,
      candidateIndex: 0,
      testKey: "flick",
      scopeKey: "hipfire",
      isPractice: false,
      trialCount: 8,
      stimulusSeed: "seed",
    },
    progress: {
      completedTrials: 3,
      targetTrials: 8,
      validTrials: 3,
      invalidTrials: 0,
      replacementsUsed: 0,
      replacementsRemaining: 2,
    },
  },
  { completedRounds: 1, totalRounds: 4 },
  0,
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the restricted effect set", () => {
  it("draws only background, target, crosshair and HUD", () => {
    const recorder = createRecordingContext();
    const renderer = createRenderer({ context: recorder.context, cssWidth: 1920, cssHeight: 1080 });
    const camera = makeCamera();
    const targets = createTargetManager();
    targets.spawn(
      { yawDeg: 10, pitchDeg: 0, angularRadiusDeg: 2, role: "scored" },
      { kind: "static" },
      0,
    );

    renderer.draw({ now: 100, camera, targets, hud: ROUND_HUD, feedback: [] });

    const names = new Set(recorder.names());
    expect(names.has("fillRect")).toBe(true); // background
    expect(names.has("arc")).toBe(true); // target
    expect(names.has("stroke")).toBe(true); // crosshair and outline
    expect(names.has("fillText")).toBe(true); // HUD

    // Nothing outside the permitted set was reached for — the proxy would have thrown.
    expect(names.has("drawImage")).toBe(false);
    expect(names.has("save")).toBe(false);
  });

  it("sets the device-pixel transform at resize, never per frame", () => {
    // A per-frame setTransform is a layout-adjacent cost inside the measured window.
    const recorder = createRecordingContext();
    const renderer = createRenderer({
      context: recorder.context,
      cssWidth: 1920,
      cssHeight: 1080,
      devicePixelRatio: 2,
    });
    const camera = makeCamera();
    const targets = createTargetManager();

    expect(recorder.names().filter((name) => name === "setTransform")).toHaveLength(1);
    expect(recorder.calls[0]?.args).toEqual([2, 0, 0, 2, 0, 0]);

    for (let frame = 0; frame < 10; frame += 1) {
      renderer.draw({ now: frame * 16, camera, targets, hud: IDLE_HUD, feedback: [] });
    }
    expect(recorder.names().filter((name) => name === "setTransform")).toHaveLength(1);

    renderer.resize(1280, 720, 1);
    expect(recorder.names().filter((name) => name === "setTransform")).toHaveLength(2);
    expect(renderer.width).toBe(1280);
    expect(renderer.height).toBe(720);
  });

  it("sizes the backing store by the device pixel ratio", () => {
    const recorder = createRecordingContext();
    createRenderer({
      context: recorder.context,
      cssWidth: 1000,
      cssHeight: 500,
      devicePixelRatio: 1.5,
    });

    const canvas = (recorder.context as unknown as { canvas: { width: number; height: number } })
      .canvas;
    expect(canvas.width).toBe(1500);
    expect(canvas.height).toBe(750);
  });
});

describe("what gets drawn", () => {
  it("draws nothing at all when headless", () => {
    // The deterministic harness runs the real engine with a null context: the loop, the input
    // and the trials are real, and only the painting is absent.
    const renderer = createRenderer({ context: null, cssWidth: 800, cssHeight: 600 });
    expect(() => {
      renderer.draw({
        now: 0,
        camera: makeCamera(),
        targets: createTargetManager(),
        hud: ROUND_HUD,
        feedback: [],
      });
    }).not.toThrow();
    expect(renderer.width).toBe(800);
  });

  it("omits a target that is behind the camera rather than drawing it somewhere wrong", () => {
    const recorder = createRecordingContext();
    const renderer = createRenderer({ context: recorder.context, cssWidth: 1920, cssHeight: 1080 });
    const camera = makeCamera();
    const targets = createTargetManager();
    targets.spawn(
      { yawDeg: 170, pitchDeg: 0, angularRadiusDeg: 2, role: "scored" },
      { kind: "static" },
      0,
    );

    renderer.draw({ now: 0, camera, targets, hud: IDLE_HUD, feedback: [] });

    // The crosshair still draws; the target does not.
    expect(recorder.names()).not.toContain("arc");
  });

  it("follows a moving target's analytic position", () => {
    const recorder = createRecordingContext();
    const renderer = createRenderer({ context: recorder.context, cssWidth: 1920, cssHeight: 1080 });
    const camera = makeCamera();
    const targets = createTargetManager();
    targets.spawn(
      { yawDeg: 0, pitchDeg: 0, angularRadiusDeg: 2, role: "scored" },
      {
        kind: "sinusoid",
        axis: "yaw",
        amplitudeDeg: 10,
        periodMs: 1000,
        phase: 0,
      },
      0,
    );

    const xAt = (now: number): number => {
      recorder.calls.length = 0;
      renderer.draw({ now, camera, targets, hud: IDLE_HUD, feedback: [] });
      const arc = recorder.calls.find((call) => call.name === "arc");
      return arc?.args[0] as number;
    };

    // A quarter period apart: the target is at its extreme, not at its origin.
    expect(xAt(250)).toBeGreaterThan(xAt(0));
  });

  it("draws the HUD without a score, an accuracy or a timer", () => {
    const recorder = createRecordingContext();
    const renderer = createRenderer({ context: recorder.context, cssWidth: 1920, cssHeight: 1080 });

    renderer.draw({
      now: 0,
      camera: makeCamera(),
      targets: createTargetManager(),
      hud: ROUND_HUD,
      feedback: [],
    });

    const text = recorder.calls
      .filter((call) => call.name === "fillText")
      .map((call) => String(call.args[0]));

    expect(text).toContain("ROUND 02");
    expect(text).toContain("3 / 8");
    // Nothing that could be read as a performance figure.
    expect(text.join(" ")).not.toMatch(/score|accuracy|%|ms\b/i);
  });

  it("uses a canvas-safe font stack, so no web font can swap mid-test", () => {
    const recorder = createRecordingContext();
    const renderer = createRenderer({ context: recorder.context, cssWidth: 1920, cssHeight: 1080 });

    renderer.draw({
      now: 0,
      camera: makeCamera(),
      targets: createTargetManager(),
      hud: ROUND_HUD,
      feedback: [],
    });

    for (const font of recorder.assignments["font"] ?? []) {
      expect(String(font)).toMatch(/monospace$/);
    }
  });

  it("expires hit and miss markers after their short lifetime", () => {
    const recorder = createRecordingContext();
    const renderer = createRenderer({ context: recorder.context, cssWidth: 1920, cssHeight: 1080 });
    const feedback: RenderFeedback[] = [{ kind: "hit", ndcX: 0, ndcY: 0, startedAt: 1000 }];

    const arcsAt = (now: number): number => {
      recorder.calls.length = 0;
      renderer.draw({
        now,
        camera: makeCamera(),
        targets: createTargetManager(),
        hud: IDLE_HUD,
        feedback,
      });
      return recorder.calls.filter((call) => call.name === "arc").length;
    };

    expect(arcsAt(1050)).toBe(1);
    expect(arcsAt(1000 + FEEDBACK_LIFETIME_MS + 1)).toBe(0);
  });

  it("marks a miss with a shape, not with colour alone", () => {
    // Colour alone excludes players with a colour vision deficiency (doc 09 §9.0.8).
    const recorder = createRecordingContext();
    const renderer = createRenderer({ context: recorder.context, cssWidth: 1920, cssHeight: 1080 });

    renderer.draw({
      now: 1000,
      camera: makeCamera(),
      targets: createTargetManager(),
      hud: IDLE_HUD,
      feedback: [{ kind: "miss", ndcX: 0.2, ndcY: -0.2, startedAt: 1000 }],
    });

    // A cross: four moveTo/lineTo pairs beyond the crosshair's own.
    const lineTos = recorder.names().filter((name) => name === "lineTo").length;
    expect(lineTos).toBeGreaterThan(4);
  });

  it("restores alpha after fading a marker, so the next frame is not dimmed", () => {
    const recorder = createRecordingContext();
    const renderer = createRenderer({ context: recorder.context, cssWidth: 1920, cssHeight: 1080 });

    renderer.draw({
      now: 1060,
      camera: makeCamera(),
      targets: createTargetManager(),
      hud: IDLE_HUD,
      feedback: [{ kind: "hit", ndcX: 0, ndcY: 0, startedAt: 1000 }],
    });

    const alphas = recorder.assignments["globalAlpha"] ?? [];
    expect(alphas.length).toBeGreaterThan(0);
    expect(alphas.at(-1)).toBe(1);
  });

  it("draws the free-aim and countdown HUDs", () => {
    const recorder = createRecordingContext();
    const renderer = createRenderer({ context: recorder.context, cssWidth: 1920, cssHeight: 1080 });
    const base = { now: 0, camera: makeCamera(), targets: createTargetManager(), feedback: [] };

    renderer.draw({
      ...base,
      hud: buildHudModel(
        { kind: "free_aim", acquisitions: 2 },
        { completedRounds: 0, totalRounds: 4 },
        5,
      ),
    });
    let text = recorder.calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
    expect(text).toContain("2 / 5");

    recorder.calls.length = 0;
    renderer.draw({
      ...base,
      hud: buildHudModel(
        { kind: "countdown", remainingMs: 2400 },
        { completedRounds: 0, totalRounds: 4 },
        0,
      ),
    });
    text = recorder.calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
    expect(text).toContain("3");
  });
});

describe("colours", () => {
  it("reads the live design tokens so canvas and UI cannot drift", () => {
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: (name: string) =>
        ({
          "--color-void": " #000000 ",
          "--color-accent": " #00ff00 ",
          "--color-text-1": " #ffffff ",
          "--color-text-3": " #888888 ",
          "--color-critical": " #ff0000 ",
        })[name] ?? "",
    }));

    const colours = coloursFromDocument({} as HTMLElement);
    expect(colours).toEqual({
      background: "#000000",
      target: "#00ff00",
      targetOutline: "#ffffff",
      crosshair: "#ffffff",
      hud: "#888888",
      hit: "#00ff00",
      miss: "#ff0000",
    });
  });

  it("falls back to the defaults for a token the document does not define", () => {
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
    expect(coloursFromDocument({} as HTMLElement)).toEqual(DEFAULT_COLOURS);
  });
});

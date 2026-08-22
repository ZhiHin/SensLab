import {
  directionFromAngles,
  offsetDirection,
  projectDirection,
  tangentAt,
  toRadians,
} from "../../core/geometry/angular";
import type { LiveTarget, TargetManager } from "../targets/target-manager";
import type { Camera } from "./camera";
import type { HudModel } from "./hud";

/**
 * The Canvas 2D renderer (ADR-005, doc 19 §19.13, `SENS-BR-021`).
 *
 * ## The restricted effect set
 *
 * This renderer can draw exactly six things: the background, the target, the hit ring, the miss
 * tick, the crosshair and the HUD. There are no gradients, no shadows, no filters, no
 * composite modes beyond `source-over`, and no per-frame allocation. Adding to that list
 * requires an ADR and a frame-budget measurement, because the product is a measuring
 * instrument before it is anything else — where a visual effect and a measurement conflict,
 * the effect is removed rather than reduced.
 *
 * At fewer than ten simple shapes, Canvas 2D sits an order of magnitude under the frame budget
 * and has more predictable pacing than WebGL, with no shader-compilation stall and no context
 * loss to handle (ADR-005).
 *
 * ## Headless
 *
 * `context` may be null. The engine then runs its full loop — input, timing, trials, quality —
 * and draws nothing. That is how the deterministic harness runs the real engine rather than a
 * simplified stand-in.
 */

export interface RendererColours {
  readonly background: string;
  readonly target: string;
  readonly targetOutline: string;
  readonly crosshair: string;
  readonly hud: string;
  readonly hit: string;
  readonly miss: string;
}

/**
 * Defaults mirroring the design tokens (doc 26 §26.3).
 *
 * The renderer reads the live tokens at init where a document is available, so the test
 * environment and the UI cannot drift apart; these are the fallbacks for a headless run.
 */
export const DEFAULT_COLOURS: RendererColours = {
  background: "#08090b",
  target: "#31e2c4",
  targetOutline: "#e8eaed",
  crosshair: "#e8eaed",
  hud: "#7a828e",
  hit: "#31e2c4",
  miss: "#ff5c5c",
};

export interface RenderFeedback {
  /** Screen-space marker for a resolved shot, cleared after its short lifetime. */
  readonly kind: "hit" | "miss";
  readonly ndcX: number;
  readonly ndcY: number;
  readonly startedAt: number;
}

export interface Renderer {
  /** Resizes the backing store. Called once at init and on an accepted resize. */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  draw(input: {
    readonly now: number;
    readonly camera: Camera;
    readonly targets: TargetManager;
    readonly hud: HudModel;
    readonly feedback: readonly RenderFeedback[];
  }): void;
  readonly width: number;
  readonly height: number;
}

/** Hit and miss markers live briefly and are drawn after the fact, so they cannot bias aim. */
export const FEEDBACK_LIFETIME_MS = 120;

export interface RendererOptions {
  readonly context: CanvasRenderingContext2D | null;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio?: number;
  readonly colours?: RendererColours;
}

export function createRenderer(options: RendererOptions): Renderer {
  const colours = options.colours ?? DEFAULT_COLOURS;
  const context = options.context;
  let width = options.cssWidth;
  let height = options.cssHeight;
  let dpr = options.devicePixelRatio ?? 1;

  const applyTransform = (): void => {
    if (context === null) return;
    const canvas = context.canvas;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    // One transform at resize, never per frame: a per-frame setTransform is a layout-adjacent
    // cost inside the measured window.
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  applyTransform();

  const toScreenX = (ndcX: number): number => (0.5 + 0.5 * ndcX) * width;
  const toScreenY = (ndcY: number): number => (0.5 - 0.5 * ndcY) * height;

  const drawTarget = (
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    target: LiveTarget,
    position: { yawDeg: number; pitchDeg: number },
  ): void => {
    const projected = camera.project(position);
    if (projected === null) return;

    const x = toScreenX(projected.ndcX);
    const y = toScreenY(projected.ndcY);

    // A circle of angular radius r projects to an ellipse. The renderer measures the projected
    // offset rather than assuming a pixel radius — cosmetic only, since hit testing happens in
    // angular space where a circle stays a circle.
    const centre = directionFromAngles(position.yawDeg, position.pitchDeg);
    const edge = offsetDirection(centre, tangentAt(centre), target.spec.angularRadiusDeg);
    const edgeProjected = projectDirection(
      edge,
      camera.basis(),
      Math.tan(toRadians(camera.horizontalHalfFovDeg)),
      Math.tan(toRadians(camera.verticalHalfFovDeg)),
    );
    if (edgeProjected === null) return;

    const radiusPx = Math.max(
      2,
      Math.hypot(toScreenX(edgeProjected.ndcX) - x, toScreenY(edgeProjected.ndcY) - y),
    );

    ctx.beginPath();
    ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = colours.target;
    ctx.fill();

    // A distinct outline plus a centre dot: the target stays locatable for low-acuity users
    // without changing the hit radius or the fill contrast (doc 09 §9.3).
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colours.targetOutline;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, radiusPx * 0.12), 0, Math.PI * 2);
    ctx.fillStyle = colours.targetOutline;
    ctx.fill();
  };

  const drawCrosshair = (ctx: CanvasRenderingContext2D): void => {
    const x = width / 2;
    const y = height / 2;
    const arm = 7;
    const gap = 3;

    ctx.strokeStyle = colours.crosshair;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - gap - arm, y);
    ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y);
    ctx.lineTo(x + gap + arm, y);
    ctx.moveTo(x, y - gap - arm);
    ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap);
    ctx.lineTo(x, y + gap + arm);
    ctx.stroke();
  };

  const drawHud = (ctx: CanvasRenderingContext2D, hud: HudModel): void => {
    const inset = 48;
    ctx.fillStyle = colours.hud;
    // A canvas-safe stack measured at init; no web font is loaded for the HUD, so no swap can
    // occur mid-test (doc 19 §19.13).
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "top";

    if (hud.roundNumber !== null) {
      ctx.textAlign = "left";
      ctx.fillText(`ROUND ${String(hud.roundNumber).padStart(2, "0")}`, inset, inset);
      ctx.textAlign = "right";
      ctx.fillText(`${hud.trialsDone} / ${hud.trialsTarget}`, width - inset, inset);
    }

    if (hud.freeAim !== null) {
      ctx.textAlign = "right";
      ctx.fillText(`${hud.freeAim.acquisitions} / ${hud.freeAim.required}`, width - inset, inset);
    }

    if (hud.countdownSeconds !== null) {
      ctx.textAlign = "center";
      ctx.font = "48px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(String(hud.countdownSeconds), width / 2, height / 2 - 120);
      ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    if (hud.hintKey.length > 0) ctx.fillText("ESC — PAUSE", inset, height - inset);
  };

  const drawFeedback = (
    ctx: CanvasRenderingContext2D,
    now: number,
    feedback: readonly RenderFeedback[],
  ): void => {
    for (const marker of feedback) {
      const age = now - marker.startedAt;
      if (age > FEEDBACK_LIFETIME_MS) continue;
      const progress = age / FEEDBACK_LIFETIME_MS;
      const x = toScreenX(marker.ndcX);
      const y = toScreenY(marker.ndcY);

      ctx.globalAlpha = 1 - progress;
      if (marker.kind === "hit") {
        // Shape and motion, never colour alone (doc 09 §9.0.8).
        ctx.strokeStyle = colours.hit;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 6 + progress * 18, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = colours.miss;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 5, y - 5);
        ctx.lineTo(x + 5, y + 5);
        ctx.moveTo(x + 5, y - 5);
        ctx.lineTo(x - 5, y + 5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  };

  return {
    get width() {
      return width;
    },
    get height() {
      return height;
    },

    resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
      width = cssWidth;
      height = cssHeight;
      dpr = devicePixelRatio;
      applyTransform();
    },

    draw({ now, camera, targets, hud, feedback }): void {
      const ctx = context;
      if (ctx === null) return;

      ctx.fillStyle = colours.background;
      ctx.fillRect(0, 0, width, height);

      for (const target of targets.living()) {
        drawTarget(ctx, camera, target, targets.positionAt(target, now));
      }

      drawFeedback(ctx, now, feedback);
      drawCrosshair(ctx);
      drawHud(ctx, hud);
    },
  };
}

/** Reads the design tokens from a live document so canvas and UI cannot drift (doc 26 §26.11). */
export function coloursFromDocument(root: HTMLElement): RendererColours {
  const styles = getComputedStyle(root);
  const token = (name: string, fallback: string): string => {
    const value = styles.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  };

  return {
    background: token("--color-void", DEFAULT_COLOURS.background),
    target: token("--color-accent", DEFAULT_COLOURS.target),
    targetOutline: token("--color-text-1", DEFAULT_COLOURS.targetOutline),
    crosshair: token("--color-text-1", DEFAULT_COLOURS.crosshair),
    hud: token("--color-text-3", DEFAULT_COLOURS.hud),
    hit: token("--color-accent", DEFAULT_COLOURS.hit),
    miss: token("--color-critical", DEFAULT_COLOURS.miss),
  };
}

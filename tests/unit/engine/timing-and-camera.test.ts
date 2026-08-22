import { describe, expect, it } from "vitest";
import { createBrowserClock, createScriptedClock } from "@/test-engine/timing/clock";
import {
  createFrameMonitor,
  DEFAULT_FRAME_THRESHOLDS,
  EMPTY_WINDOW,
  isDegraded,
} from "@/test-engine/timing/frame-monitor";
import { createCamera, MAX_PITCH_DEG } from "@/test-engine/render/camera";
import { countsPer360FromCm, degreesPerCount } from "@/core/sensitivity/canonical";

const BUDGET_60HZ = 1000 / 60;

describe("scripted clock", () => {
  it("advances only when told to", () => {
    const clock = createScriptedClock(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(50);
    expect(clock.now()).toBe(1050);
  });

  it("fires one scheduled frame per tick", () => {
    const clock = createScriptedClock();
    const seen: number[] = [];
    const reschedule = (t: number): void => {
      seen.push(t);
      clock.scheduleFrame(reschedule);
    };
    clock.scheduleFrame(reschedule);

    clock.tick(16);
    clock.tick(16);
    expect(seen).toEqual([16, 32]);
  });

  it("reports when nothing is scheduled", () => {
    const clock = createScriptedClock();
    expect(clock.tick(16)).toBe(false);
  });

  it("cancels a scheduled frame", () => {
    const clock = createScriptedClock();
    let fired = false;
    const handle = clock.scheduleFrame(() => {
      fired = true;
    });
    clock.cancelFrame(handle);
    clock.tick(16);
    expect(fired).toBe(false);
    expect(clock.pendingFrames).toBe(0);
  });

  it("runs a fixed cadence for a duration", () => {
    const clock = createScriptedClock();
    let frames = 0;
    const loop = (): void => {
      frames += 1;
      clock.scheduleFrame(loop);
    };
    clock.scheduleFrame(loop);
    clock.run(100, 10);
    expect(frames).toBe(10);
  });

  it("rejects a non-positive frame interval", () => {
    const clock = createScriptedClock();
    expect(() => clock.run(100, 0)).toThrow(RangeError);
  });

  it("can be set to an absolute time", () => {
    const clock = createScriptedClock();
    clock.set(5000);
    expect(clock.now()).toBe(5000);
  });

  it("exposes a browser clock backed by performance.now", () => {
    // Constructed only; driving it needs a real rAF.
    const clock = createBrowserClock();
    expect(typeof clock.now()).toBe("number");
  });
});

describe("frame monitor", () => {
  it("reports no evidence, not poor quality, before any frames", () => {
    const monitor = createFrameMonitor({ frameBudgetMs: BUDGET_60HZ });
    expect(monitor.sessionStats()).toEqual(EMPTY_WINDOW);
    expect(monitor.sessionStats().cleanFrameFraction).toBe(1);
  });

  it("classifies frames past 1.25× budget as late", () => {
    const monitor = createFrameMonitor({ frameBudgetMs: BUDGET_60HZ });
    monitor.openWindow();
    monitor.record(0);
    monitor.record(16.7); // on budget
    monitor.record(33.4); // on budget
    monitor.record(60); // 26.6 ms — late
    const stats = monitor.closeWindow();

    expect(stats.frames).toBe(3);
    expect(stats.lateFrames).toBe(1);
    expect(stats.cleanFrameFraction).toBeCloseTo(2 / 3, 6);
  });

  it("counts a gap over 100 ms as a hitch — the invalidating condition", () => {
    const monitor = createFrameMonitor({ frameBudgetMs: BUDGET_60HZ });
    monitor.openWindow();
    monitor.record(0);
    monitor.record(16.7);
    expect(monitor.windowHasHitch()).toBe(false);
    monitor.record(160);
    expect(monitor.windowHasHitch()).toBe(true);
    expect(monitor.closeWindow().hitches).toBe(1);
  });

  it("attributes frames only to the window that was open", () => {
    const monitor = createFrameMonitor({ frameBudgetMs: BUDGET_60HZ });
    monitor.record(0);
    monitor.record(16.7); // before any window
    monitor.openWindow();
    monitor.record(33.4);
    monitor.record(50.1);
    const window = monitor.closeWindow();

    expect(window.frames).toBe(2);
    expect(monitor.sessionStats().frames).toBe(3);
  });

  it("drops non-positive intervals rather than counting them as fast frames", () => {
    const monitor = createFrameMonitor({ frameBudgetMs: BUDGET_60HZ });
    monitor.openWindow();
    monitor.record(100);
    monitor.record(90); // replayed or reordered
    monitor.record(106.7);
    expect(monitor.closeWindow().frames).toBe(1);
  });

  it("adapts to the measured refresh rate", () => {
    const monitor = createFrameMonitor({ frameBudgetMs: BUDGET_60HZ });
    monitor.setFrameBudgetMs(1000 / 240);
    expect(monitor.frameBudgetMs).toBeCloseTo(4.1667, 3);

    monitor.openWindow();
    monitor.record(0);
    // 8 ms is comfortable at 60 Hz and late at 240 Hz.
    monitor.record(8);
    expect(monitor.closeWindow().lateFrames).toBe(1);
  });

  it("rejects an impossible frame budget", () => {
    const monitor = createFrameMonitor();
    expect(() => monitor.setFrameBudgetMs(0)).toThrow(RangeError);
    expect(() => monitor.setFrameBudgetMs(Number.NaN)).toThrow(RangeError);
  });

  it("computes a p95 that tracks the tail", () => {
    const monitor = createFrameMonitor({ frameBudgetMs: BUDGET_60HZ });
    monitor.openWindow();
    let t = 0;
    for (let i = 0; i < 100; i += 1) {
      t += i === 99 ? 90 : 16.7;
      monitor.record(t);
    }
    const stats = monitor.closeWindow();
    expect(stats.maxIntervalMs).toBeCloseTo(90, 6);
    expect(stats.p95IntervalMs).toBeGreaterThan(16);
  });

  it("marks a trial degraded past the 8% late-frame ratio", () => {
    // 10% late is over the line; 5% and 1% are not.
    expect(isDegraded({ ...EMPTY_WINDOW, frames: 100, cleanFrameFraction: 0.9 })).toBe(true);
    expect(isDegraded({ ...EMPTY_WINDOW, frames: 100, cleanFrameFraction: 0.95 })).toBe(false);
    expect(isDegraded({ ...EMPTY_WINDOW, frames: 100, cleanFrameFraction: 0.99 })).toBe(false);
    // Exactly at the threshold is not over it.
    expect(isDegraded({ ...EMPTY_WINDOW, frames: 100, cleanFrameFraction: 0.92 })).toBe(false);
    // No frames is not evidence of degradation.
    expect(isDegraded(EMPTY_WINDOW)).toBe(false);
    expect(DEFAULT_FRAME_THRESHOLDS.degradedTrialRatio).toBe(0.08);
  });

  it("peeks at the open window without closing it", () => {
    const monitor = createFrameMonitor({ frameBudgetMs: BUDGET_60HZ });
    monitor.openWindow();
    monitor.record(0);
    monitor.record(16.7);
    expect(monitor.peekWindow().frames).toBe(1);
    expect(monitor.peekWindow().frames).toBe(1);
    expect(monitor.closeWindow().frames).toBe(1);
    expect(monitor.peekWindow()).toEqual(EMPTY_WINDOW);
  });

  it("bounds retained interval samples so a long session cannot grow unbounded", () => {
    const monitor = createFrameMonitor({ frameBudgetMs: BUDGET_60HZ, maxRetainedIntervals: 10 });
    monitor.openWindow();
    for (let i = 1; i <= 100; i += 1) monitor.record(i * 16.7);
    const stats = monitor.closeWindow();
    // 100 timestamps produce 99 intervals: the first record establishes the baseline rather
    // than an interval. Every one of them is counted; only the sample set retained for the
    // percentile estimate is capped.
    expect(stats.frames).toBe(99);
  });
});

describe("camera", () => {
  const degPerCount = degreesPerCount(countsPer360FromCm(30, 800));

  const makeCamera = () =>
    createCamera({ horizontalHalfFovDeg: 51.5, aspectRatio: 16 / 9, degreesPerCount: degPerCount });

  it("turns exactly 360° for exactly counts/360 counts — SENS-FR-054", () => {
    const camera = makeCamera();
    const counts = countsPer360FromCm(30, 800);
    camera.applyCounts(counts, 0);
    expect(camera.yawDeg).toBeCloseTo(360, 9);
  });

  it("integrates linearly: no acceleration, no smoothing, no dead zone", () => {
    const camera = makeCamera();

    // One large movement and many small ones must land in exactly the same place. Any
    // acceleration curve, smoothing filter or dead zone would break this.
    camera.applyCounts(1000, 0);
    const oneShot = camera.yawDeg;

    const stepwise = makeCamera();
    for (let i = 0; i < 1000; i += 1) stepwise.applyCounts(1, 0);
    expect(stepwise.yawDeg).toBeCloseTo(oneShot, 9);
  });

  it("lowers the view for a downward movement", () => {
    const camera = makeCamera();
    camera.applyCounts(0, 100);
    expect(camera.pitchDeg).toBeLessThan(0);
  });

  it("clamps pitch at ±89°, the only non-linearity it has", () => {
    const camera = makeCamera();
    camera.applyCounts(0, -1_000_000);
    expect(camera.pitchDeg).toBe(MAX_PITCH_DEG);

    camera.applyCounts(0, 2_000_000);
    expect(camera.pitchDeg).toBe(-MAX_PITCH_DEG);
  });

  it("does not clamp yaw: a player may turn as far as they like", () => {
    const camera = makeCamera();
    camera.applyCounts(countsPer360FromCm(30, 800) * 3, 0);
    expect(camera.yawDeg).toBeCloseTo(1080, 6);
  });

  it("ignores non-finite input rather than poisoning the camera state", () => {
    const camera = makeCamera();
    camera.applyCounts(100, 0);
    const before = camera.yawDeg;
    camera.applyCounts(Number.NaN, 0);
    camera.applyCounts(0, Number.POSITIVE_INFINITY);
    expect(camera.yawDeg).toBe(before);
    expect(Number.isFinite(camera.pitchDeg)).toBe(true);
  });

  it("accumulates raw counts independently of the angle", () => {
    const camera = makeCamera();
    camera.applyCounts(120, -40);
    expect(camera.accumulatedCounts).toEqual({ dx: 120, dy: -40 });
    camera.resetCounts();
    expect(camera.accumulatedCounts).toEqual({ dx: 0, dy: 0 });
    // Resetting the counter does not move the camera.
    expect(camera.yawDeg).not.toBe(0);
  });

  it("changes sensitivity only when asked, and validates it", () => {
    const camera = makeCamera();
    camera.setDegreesPerCount(degPerCount * 2);
    camera.applyCounts(100, 0);
    expect(camera.yawDeg).toBeCloseTo(100 * degPerCount * 2, 9);

    expect(() => camera.setDegreesPerCount(0)).toThrow(RangeError);
    expect(() => camera.setDegreesPerCount(-1)).toThrow(RangeError);
  });

  it("derives the vertical FOV from the aspect ratio", () => {
    const wide = createCamera({
      horizontalHalfFovDeg: 51.5,
      aspectRatio: 16 / 9,
      degreesPerCount: degPerCount,
    });
    const square = createCamera({
      horizontalHalfFovDeg: 51.5,
      aspectRatio: 1,
      degreesPerCount: degPerCount,
    });
    expect(wide.verticalHalfFovDeg).toBeLessThan(square.verticalHalfFovDeg);
    expect(square.verticalHalfFovDeg).toBeCloseTo(51.5, 6);
  });

  it("rejects an impossible FOV or aspect ratio", () => {
    expect(() =>
      createCamera({ horizontalHalfFovDeg: 0, aspectRatio: 1, degreesPerCount: 0.01 }),
    ).toThrow(RangeError);
    expect(() =>
      createCamera({ horizontalHalfFovDeg: 90, aspectRatio: 1, degreesPerCount: 0.01 }),
    ).toThrow(RangeError);
    expect(() =>
      createCamera({ horizontalHalfFovDeg: 50, aspectRatio: 0, degreesPerCount: 0.01 }),
    ).toThrow(RangeError);
  });

  it("projects a target ahead to the screen centre and refreshes as it turns", () => {
    const camera = makeCamera();
    const straightAhead = camera.project({ yawDeg: 0, pitchDeg: 0 });
    expect(straightAhead?.ndcX).toBeCloseTo(0, 9);

    camera.applyCounts(countsPer360FromCm(30, 800) / 36, 0); // 10° right
    const afterTurn = camera.project({ yawDeg: 0, pitchDeg: 0 });
    expect(afterTurn?.ndcX ?? 0).toBeLessThan(-0.01);
  });

  it("sets angles directly for a round reset, clamping pitch", () => {
    const camera = makeCamera();
    camera.setAngles(45, 120);
    expect(camera.yawDeg).toBe(45);
    expect(camera.pitchDeg).toBe(MAX_PITCH_DEG);
  });
});

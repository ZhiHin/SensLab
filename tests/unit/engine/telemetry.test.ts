import { describe, expect, it } from "vitest";
import { createTelemetryBuffers, sizeBuffers } from "@/test-engine/telemetry/ring-buffer";
import {
  createMetricCollector,
  DuplicateDerivationError,
  toTrialRecord,
  type TrialObservation,
} from "@/test-engine/telemetry/metric-collector";
import { createTargetManager } from "@/test-engine/targets/target-manager";

/**
 * Telemetry buffering and the metric seam (doc 19 §19.7, `SENS-NFR-003`).
 *
 * The tests that matter most here are the overflow ones. Overflow is rare and, handled wrongly,
 * silent: a buffer that overwrites input samples oldest-first still returns a full-looking
 * array, and every metric derived from it would be plausible and wrong. So the policy is
 * asymmetric, and these tests pin the asymmetry down.
 */

describe("buffer sizing", () => {
  it("sizes for the worst case the plan allows, with headroom", () => {
    const capacity = sizeBuffers({ timeoutMs: 2500, maxPollingRateHz: 1000, maxRefreshHz: 240 });
    // 2.5 s × 1000 Hz × 1.5 headroom.
    expect(capacity.inputCapacity).toBe(3750);
    expect(capacity.frameCapacity).toBe(900);
    expect(capacity.eventCapacity).toBe(256);
  });

  it("holds a floor, so a very short trial still has a usable buffer", () => {
    const capacity = sizeBuffers({ timeoutMs: 50, maxPollingRateHz: 125, maxRefreshHz: 60 });
    expect(capacity.inputCapacity).toBe(256);
    expect(capacity.frameCapacity).toBe(128);
  });

  it("scales with polling rate, so an 8000 Hz mouse is not silently truncated", () => {
    const high = sizeBuffers({ timeoutMs: 2500, maxPollingRateHz: 8000, maxRefreshHz: 240 });
    expect(high.inputCapacity).toBe(30_000);
  });
});

describe("telemetry buffers", () => {
  const small = { inputCapacity: 4, frameCapacity: 4, eventCapacity: 3 };

  it("records and returns samples in order", () => {
    const buffers = createTelemetryBuffers(small);
    buffers.recordInput(1, 10, 0);
    buffers.recordInput(2, 20, 1);

    const view = buffers.input();
    expect(view.count).toBe(2);
    expect([...view.t]).toEqual([1, 2]);
    expect([...view.yaw]).toEqual([10, 20]);
    expect([...view.pitch]).toEqual([0, 1]);
    expect(buffers.overflowed).toBe(false);
  });

  it("drops the OLDEST frame samples on overflow — doc 19 §19.7", () => {
    const buffers = createTelemetryBuffers(small);
    for (let i = 1; i <= 6; i += 1) buffers.recordFrame(i, i * 10, 0);

    const view = buffers.frames();
    expect(view.count).toBe(4);
    // The two earliest frames are gone; the four most recent survive, in order.
    expect([...view.t]).toEqual([3, 4, 5, 6]);
    expect(buffers.overflowed).toBe(true);
  });

  it("unrolls a wrapped frame ring into chronological order", () => {
    const buffers = createTelemetryBuffers({ ...small, frameCapacity: 3 });
    for (let i = 1; i <= 5; i += 1) buffers.recordFrame(i, i, -i);

    const view = buffers.frames();
    expect([...view.t]).toEqual([3, 4, 5]);
    expect([...view.yaw]).toEqual([3, 4, 5]);
    expect([...view.pitch]).toEqual([-3, -4, -5]);
  });

  it("keeps a contiguous prefix of input samples rather than a corrupted whole", () => {
    // Overwriting oldest-first here would silently corrupt path length and correction counting.
    // Stopping and flagging produces an obviously incomplete trial instead of a plausible
    // wrong number.
    const buffers = createTelemetryBuffers(small);
    for (let i = 1; i <= 7; i += 1) buffers.recordInput(i, i, 0);

    const view = buffers.input();
    expect(view.count).toBe(4);
    expect([...view.t]).toEqual([1, 2, 3, 4]);
    expect(buffers.overflowed).toBe(true);
  });

  it("never discards a button event that fitted, and flags the ones that did not", () => {
    const buffers = createTelemetryBuffers(small);
    buffers.recordEvent(1, 0, 0);
    buffers.recordEvent(2, 1, 0);
    buffers.recordEvent(3, 0, 0);
    expect(buffers.overflowed).toBe(false);

    buffers.recordEvent(4, 1, 0);
    expect(buffers.overflowed).toBe(true);

    const view = buffers.events();
    expect(view.count).toBe(3);
    expect([...view.t]).toEqual([1, 2, 3]);
    expect([...view.phase]).toEqual([0, 1, 0]);
  });

  it("clears counts and the overflow flag on reset without reallocating", () => {
    const buffers = createTelemetryBuffers(small);
    for (let i = 0; i < 10; i += 1) buffers.recordInput(i, i, 0);
    expect(buffers.overflowed).toBe(true);

    const capacityBefore = buffers.capacity;
    buffers.reset();

    expect(buffers.overflowed).toBe(false);
    expect(buffers.input().count).toBe(0);
    expect(buffers.frames().count).toBe(0);
    expect(buffers.events().count).toBe(0);
    // Same capacity object: reset does not resize, so no allocation happens between trials.
    expect(buffers.capacity).toBe(capacityBefore);
  });

  it("returns a chronological frame view again after a reset clears the wrap", () => {
    const buffers = createTelemetryBuffers({ ...small, frameCapacity: 3 });
    for (let i = 1; i <= 5; i += 1) buffers.recordFrame(i, i, 0);
    buffers.reset();
    buffers.recordFrame(100, 1, 0);
    buffers.recordFrame(101, 2, 0);

    expect([...buffers.frames().t]).toEqual([100, 101]);
  });

  it("allocates nothing per sample: views are subarrays of the same backing store", () => {
    const buffers = createTelemetryBuffers(small);
    buffers.recordInput(1, 0, 0);
    const first = buffers.input();
    buffers.recordInput(2, 0, 0);
    const second = buffers.input();
    expect(second.t.buffer).toBe(first.t.buffer);
  });
});

describe("metric collector", () => {
  const observation = (): TrialObservation => {
    const buffers = createTelemetryBuffers({
      inputCapacity: 8,
      frameCapacity: 8,
      eventCapacity: 8,
    });
    buffers.recordInput(10, 1, 0);
    return {
      trialIndex: 2,
      isPractice: false,
      variant: null,
      stimulusAt: 1000,
      resolvedAt: 1450,
      inputSamples: buffers.input(),
      frameSamples: buffers.frames(),
      events: buffers.events(),
      originAngles: { yawDeg: 0, pitchDeg: 0 },
      targets: [],
      targetManager: createTargetManager(),
      shots: 1,
      hit: true,
      firstShotHit: true,
      quality: { cleanFrameFraction: 1, hitchCount: 0, bufferOverflow: false },
    };
  };

  it("registers no derivations in Phase 2 — the framework, not the metrics", () => {
    expect(createMetricCollector().keys()).toEqual([]);
  });

  it("runs only the derivations the test declared", () => {
    const collector = createMetricCollector();
    collector.register({ key: "wanted", derive: () => 42 });
    collector.register({ key: "unwanted", derive: () => 7 });

    expect(collector.collect(observation(), ["wanted"])).toEqual({ wanted: 42 });
    expect(collector.keys()).toEqual(["unwanted", "wanted"]);
  });

  it("omits a metric a derivation declined rather than storing a zero", () => {
    // "Not applicable" and "measured as zero" must never be the same value downstream.
    const collector = createMetricCollector();
    collector.register({ key: "notApplicable", derive: () => null });
    expect(collector.collect(observation(), ["notApplicable"])).toEqual({});
  });

  it("drops a non-finite result rather than letting NaN propagate into aggregates", () => {
    const collector = createMetricCollector();
    collector.register({ key: "broken", derive: () => Number.NaN });
    collector.register({ key: "infinite", derive: () => Number.POSITIVE_INFINITY });
    expect(collector.collect(observation(), ["broken", "infinite"])).toEqual({});
  });

  it("tolerates a declared key with no registered derivation", () => {
    // A Phase 3 metric key on a definition must not stop the definition running today.
    const collector = createMetricCollector();
    expect(collector.collect(observation(), ["phase3.metric"])).toEqual({});
  });

  it("refuses a duplicate registration instead of silently replacing one", () => {
    const collector = createMetricCollector();
    collector.register({ key: "dup", derive: () => 1 });
    expect(() => collector.register({ key: "dup", derive: () => 2 })).toThrow(
      DuplicateDerivationError,
    );
  });

  it("gives a derivation a read-only view of the trial, never the engine", () => {
    const collector = createMetricCollector();
    let seenShots = -1;
    collector.register({
      key: "peek",
      derive: (obs) => {
        seenShots = obs.shots;
        return obs.resolvedAt - obs.stimulusAt;
      },
    });

    expect(collector.collect(observation(), ["peek"])).toEqual({ peek: 450 });
    expect(seenShots).toBe(1);
  });

  it("assembles a trial record with the duration derived from the measured window", () => {
    const record = toTrialRecord(
      observation(),
      { acquisitionMs: 320 },
      {
        validity: "valid",
        invalidReason: null,
        isReplacement: false,
        startOffsetMs: 500,
        stimulusSeed: "round-1:2",
        variant: null,
        qualityFlags: [],
        targetAngularRadiusDeg: 2,
        targetDistanceDeg: 18,
        targetDirectionDeg: 0,
      },
    );

    expect(record.durationMs).toBe(450);
    expect(record.trialIndex).toBe(2);
    expect(record.metrics).toEqual({ acquisitionMs: 320 });
    expect(record.validity).toBe("valid");
    expect(record.invalidReason).toBeNull();
  });
});

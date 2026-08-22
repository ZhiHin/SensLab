import { describe, expect, it } from "vitest";
import { countReversals, highPassFirstOrder, zeroCrossingRate } from "@/core/signal";

/**
 * The signal kernels (doc 10 §10.3–§10.4).
 *
 * These are small, and they are load-bearing: `jitterRMS` and `trackingStability` are entirely
 * determined by the high-pass, and `correctionCount` by the reversal counter. A subtly wrong
 * filter produces a number that is in range, stable across runs, and wrong — which is the
 * failure mode this whole product is built to avoid.
 */

/** A series sampled at a fixed rate, for readability in the cases below. */
function at(rateHz: number, values: readonly number[]): { t: Float64Array; x: Float64Array } {
  const step = 1000 / rateHz;
  const t = new Float64Array(values.length);
  const x = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    t[i] = i * step;
    x[i] = values[i] as number;
  }
  return { t, x };
}

describe("highPassFirstOrder", () => {
  it("removes a constant entirely", () => {
    // A hand held perfectly still has no tremor. If a DC offset survived the filter, every
    // player who aimed slightly off-centre would read as shaky.
    const { t, x } = at(
      1000,
      Array.from({ length: 200 }, () => 4.2),
    );
    const out = highPassFirstOrder(x, t, 6);
    for (const value of out) expect(value).toBeCloseTo(0, 9);
  });

  it("passes a fast oscillation through nearly intact", () => {
    // 200 Hz against a 6 Hz corner: far above the passband edge, so the amplitude survives.
    const samples = Array.from({ length: 400 }, (_, i) => (i % 2 === 0 ? 1 : -1));
    const { t, x } = at(1000, samples);
    const out = highPassFirstOrder(x, t, 6);

    const tail = Array.from(out.subarray(50));
    const amplitude = Math.max(...tail.map(Math.abs));
    expect(amplitude).toBeGreaterThan(0.9);
  });

  it("attenuates a slow oscillation", () => {
    // 1 Hz against a 6 Hz corner: well inside the stopband.
    const samples = Array.from({ length: 2000 }, (_, i) => Math.sin((2 * Math.PI * i) / 1000));
    const { t, x } = at(1000, samples);
    const out = highPassFirstOrder(x, t, 6);

    const tail = Array.from(out.subarray(500));
    expect(Math.max(...tail.map(Math.abs))).toBeLessThan(0.3);
  });

  it("keeps its corner frequency when the sample rate changes", () => {
    // The reason Δt is per-sample rather than assumed: a player on a 125 Hz mouse and one on a
    // 1000 Hz mouse must be filtered identically, or the metric would measure their hardware.
    const slow = at(
      125,
      Array.from({ length: 250 }, (_, i) => Math.sin((2 * Math.PI * i) / 125)),
    );
    const fast = at(
      1000,
      Array.from({ length: 2000 }, (_, i) => Math.sin((2 * Math.PI * i) / 1000)),
    );

    const slowOut = Array.from(highPassFirstOrder(slow.x, slow.t, 6).subarray(60));
    const fastOut = Array.from(highPassFirstOrder(fast.x, fast.t, 6).subarray(500));

    const slowAmplitude = Math.max(...slowOut.map(Math.abs));
    const fastAmplitude = Math.max(...fastOut.map(Math.abs));
    expect(slowAmplitude).toBeCloseTo(fastAmplitude, 1);
  });

  it("survives a duplicated or reordered timestamp without producing an impulse", () => {
    // Event streams do occasionally repeat a timestamp. A naive Δt division would turn that
    // into an infinite spike and poison the RMS for the whole trial.
    const t = new Float64Array([0, 1, 1, 2, 1.5, 3]);
    const x = new Float64Array([0, 1, 2, 3, 4, 5]);
    const out = highPassFirstOrder(x, t, 6);
    for (const value of out) expect(Number.isFinite(value)).toBe(true);
  });

  it("starts at zero, because a high-pass has no history for its first sample", () => {
    const { t, x } = at(1000, [7, 7, 7]);
    expect(highPassFirstOrder(x, t, 6)[0]).toBe(0);
  });

  it("returns an empty result for an empty series", () => {
    expect(highPassFirstOrder(new Float64Array(0), new Float64Array(0), 6)).toHaveLength(0);
  });

  it("refuses an impossible cutoff or a mismatched series", () => {
    const { t, x } = at(1000, [1, 2, 3]);
    expect(() => highPassFirstOrder(x, t, 0)).toThrow(RangeError);
    expect(() => highPassFirstOrder(x, t, -1)).toThrow(RangeError);
    expect(() => highPassFirstOrder(x, new Float64Array(2), 6)).toThrow(RangeError);
  });
});

describe("zeroCrossingRate", () => {
  it("counts sign changes per second", () => {
    // Ten samples alternating at 1 kHz: nine crossings over 9 ms.
    const { t, x } = at(1000, [1, -1, 1, -1, 1, -1, 1, -1, 1, -1]);
    expect(zeroCrossingRate(x, t)).toBeCloseTo(9 / 0.009, 6);
  });

  it("does not count touching zero as a crossing", () => {
    // A series that returns to the same side has not reversed direction.
    const { t, x } = at(1000, [1, 0, 1, 0, 1]);
    expect(zeroCrossingRate(x, t)).toBe(0);
  });

  it("counts a crossing that passes through zero", () => {
    const { t, x } = at(1000, [1, 0, -1]);
    expect(zeroCrossingRate(x, t)).toBeGreaterThan(0);
  });

  it("returns zero rather than dividing by nothing", () => {
    expect(zeroCrossingRate(new Float64Array(0), new Float64Array(0))).toBe(0);
    expect(zeroCrossingRate(new Float64Array([1]), new Float64Array([0]))).toBe(0);
    // No elapsed time: a rate is undefined, and reporting Infinity would poison the aggregate.
    expect(zeroCrossingRate(new Float64Array([1, -1]), new Float64Array([5, 5]))).toBe(0);
  });
});

describe("countReversals", () => {
  it("counts a genuine there-and-back as one reversal", () => {
    const { t, x } = at(1000, [...Array<number>(50).fill(100), ...Array<number>(50).fill(-100)]);
    expect(countReversals(x, t, 20, 25)).toBe(1);
  });

  it("ignores movement below the hysteresis threshold", () => {
    // Sensor noise alternates sign constantly. Without hysteresis this trace would report
    // dozens of corrections that never happened.
    const { t, x } = at(
      1000,
      Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 5 : -5)),
    );
    expect(countReversals(x, t, 20, 25)).toBe(0);
  });

  it("collapses reversals inside the refractory period into one", () => {
    // One physical correction can produce several sign changes within a few milliseconds.
    const values: number[] = [];
    for (let i = 0; i < 20; i += 1) values.push(i % 2 === 0 ? 100 : -100);
    const { t, x } = at(1000, values);

    const withRefractory = countReversals(x, t, 20, 25);
    const without = countReversals(x, t, 20, 0);
    expect(withRefractory).toBeLessThan(without);
    expect(withRefractory).toBeGreaterThan(0);
  });

  it("counts nothing for a series that never exceeds the threshold", () => {
    const { t, x } = at(1000, [0, 0, 0, 0]);
    expect(countReversals(x, t, 20, 25)).toBe(0);
  });

  it("counts nothing for a single sustained direction", () => {
    const { t, x } = at(
      1000,
      Array.from({ length: 100 }, () => 80),
    );
    expect(countReversals(x, t, 20, 25)).toBe(0);
  });

  it("handles an empty series", () => {
    expect(countReversals(new Float64Array(0), new Float64Array(0), 20, 25)).toBe(0);
  });
});

/**
 * Signal-processing primitives for movement traces (doc 10 §10.3–§10.4).
 *
 * These exist because several metrics need to separate *deliberate movement* from *tremor and
 * micro-correction*, and raw variance cannot do that: a slow deliberate approach and a shaky
 * hover produce similar spread. The difference between them lives in the frequency band, so
 * the separation has to be a filter.
 *
 * Everything here is a pure function of a sample series and its timestamps. Sample spacing is
 * **not** assumed uniform — a mouse polls at its own rate and a frame hitch leaves a gap, so a
 * fixed-`dt` filter would silently change its own cutoff whenever the machine stuttered.
 */

/**
 * First-order high-pass filter with a per-sample time step.
 *
 * The discrete form of an RC high-pass, with α recomputed for each interval:
 *
 * ```
 *   RC   = 1 / (2π·fc)
 *   α    = RC / (RC + Δt)
 *   y[i] = α · (y[i-1] + x[i] − x[i-1])
 * ```
 *
 * @param values     the series to filter
 * @param timestamps sample times in milliseconds, monotonically non-decreasing
 * @param cutoffHz   the −3 dB corner frequency
 * @returns a series the same length as `values`; the first element is always 0, because a
 *          high-pass has no history to remove from its first sample.
 */
export function highPassFirstOrder(
  values: ArrayLike<number>,
  timestamps: ArrayLike<number>,
  cutoffHz: number,
): Float64Array {
  if (!(cutoffHz > 0)) {
    throw new RangeError(`high-pass cutoff must be positive, received ${cutoffHz}`);
  }
  if (values.length !== timestamps.length) {
    throw new RangeError(
      `values and timestamps must be the same length, received ${values.length} and ${timestamps.length}`,
    );
  }

  const out = new Float64Array(values.length);
  if (values.length === 0) return out;

  const rc = 1 / (2 * Math.PI * cutoffHz);
  let previousInput = values[0] as number;
  let previousOutput = 0;

  for (let i = 1; i < values.length; i += 1) {
    const input = values[i] as number;
    const deltaSeconds = ((timestamps[i] as number) - (timestamps[i - 1] as number)) / 1000;

    // A non-positive step carries no new information; passing it through would divide by zero
    // and turn a duplicated timestamp into an infinite impulse.
    if (deltaSeconds <= 0) {
      out[i] = previousOutput;
      previousInput = input;
      continue;
    }

    const alpha = rc / (rc + deltaSeconds);
    previousOutput = alpha * (previousOutput + input - previousInput);
    previousInput = input;
    out[i] = previousOutput;
  }

  return out;
}

/**
 * Zero-crossing rate of a series, in hertz.
 *
 * Counts sign changes and divides by the elapsed time. Zeros are not crossings in themselves —
 * a series that touches zero and returns has not reversed — so the sign of the last non-zero
 * sample is what carries forward.
 */
export function zeroCrossingRate(values: ArrayLike<number>, timestamps: ArrayLike<number>): number {
  if (values.length < 2) return 0;

  const elapsedSeconds =
    ((timestamps[timestamps.length - 1] as number) - (timestamps[0] as number)) / 1000;
  if (elapsedSeconds <= 0) return 0;

  let crossings = 0;
  let previousSign = 0;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    const sign = value > 0 ? 1 : value < 0 ? -1 : 0;
    if (sign === 0) continue;
    if (previousSign !== 0 && sign !== previousSign) crossings += 1;
    previousSign = sign;
  }

  return crossings / elapsedSeconds;
}

/**
 * Counts direction reversals with hysteresis and a refractory period.
 *
 * Both guards are essential rather than decorative. A bare sign-change count on a real mouse
 * trace reports dozens of "corrections" per trial that are sensor noise, not intent: the
 * hysteresis threshold requires a genuine movement in the new direction before a reversal
 * registers, and the refractory period stops one physical correction being counted as several.
 *
 * @param signedRate  signed rate of progress along the movement axis, degrees per second
 * @param timestamps  sample times in milliseconds
 * @param thresholdDegPerSec speed that must be exceeded in each direction (doc 10: 20°/s)
 * @param refractoryMs minimum gap between counted reversals (doc 10: 25 ms)
 */
export function countReversals(
  signedRate: ArrayLike<number>,
  timestamps: ArrayLike<number>,
  thresholdDegPerSec: number,
  refractoryMs: number,
): number {
  let reversals = 0;
  // The direction of the last movement that actually exceeded the threshold.
  let establishedSign = 0;
  let lastReversalAt = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < signedRate.length; i += 1) {
    const rate = signedRate[i] as number;
    if (Math.abs(rate) <= thresholdDegPerSec) continue;

    const sign = rate > 0 ? 1 : -1;
    if (establishedSign === 0) {
      establishedSign = sign;
      continue;
    }

    if (sign !== establishedSign) {
      const at = timestamps[i] as number;
      if (at - lastReversalAt >= refractoryMs) {
        reversals += 1;
        lastReversalAt = at;
      }
      establishedSign = sign;
    }
  }

  return reversals;
}

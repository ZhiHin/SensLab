/**
 * Resampling and lag estimation for irregularly sampled signals.
 *
 * Mouse samples arrive at the polling rate, which is neither constant nor the same between
 * players, so a lag expressed in samples would mean different things on different hardware.
 * Everything here works on a uniform time grid built by linear interpolation, and reports lags
 * in milliseconds.
 */

/** Linearly interpolates `(timestamps, values)` onto a uniform grid. */
export function resampleUniform(
  timestamps: ArrayLike<number>,
  values: ArrayLike<number>,
  fromMs: number,
  toMs: number,
  stepMs: number,
): Float64Array {
  if (!(stepMs > 0)) throw new RangeError(`step must be positive, received ${stepMs}`);
  const count = Math.max(0, Math.floor((toMs - fromMs) / stepMs) + 1);
  const out = new Float64Array(count);
  if (timestamps.length === 0) return out;

  let cursor = 0;
  for (let i = 0; i < count; i += 1) {
    const t = fromMs + i * stepMs;
    while (cursor + 1 < timestamps.length && (timestamps[cursor + 1] as number) <= t) cursor += 1;

    const t0 = timestamps[cursor] as number;
    const v0 = values[cursor] as number;
    if (cursor + 1 >= timestamps.length || t <= t0) {
      out[i] = v0;
      continue;
    }
    const t1 = timestamps[cursor + 1] as number;
    const v1 = values[cursor + 1] as number;
    const span = t1 - t0;
    out[i] = span > 0 ? v0 + ((v1 - v0) * (t - t0)) / span : v0;
  }
  return out;
}

/**
 * The lag at which `response` best matches `reference`, by windowed Pearson correlation.
 *
 * Positive means the response *trails* the reference. Lags are searched from 0 to
 * `maxLagSamples`; a response that leads the reference is reported as zero lag, because a
 * player cannot anticipate a seeded acceleration and a negative estimate would be noise.
 *
 * ## Why the correlation is normalised per lag
 *
 * The signals are finite, so each lag compares a different overlapping segment. A single
 * global mean and variance would let the shrinking overlap bias the estimate towards small
 * lags — the segment that includes the most of a long plateau wins regardless of alignment.
 * Computing the Pearson coefficient on each lag's own overlap removes that: every lag is
 * judged on how well its segment *aligns*, not on how much of it there is.
 *
 * Returns `null` when the reference has no variance — a flat line correlates with nothing.
 */
export function crossCorrelationLag(
  reference: ArrayLike<number>,
  response: ArrayLike<number>,
  maxLagSamples: number,
): number | null {
  const n = Math.min(reference.length, response.length);
  if (n < 4) return null;

  let bestLag: number | null = null;
  let best = -Infinity;
  // Keep at least half the signal in the overlap, so a lag cannot be chosen on a handful of
  // points that happen to line up.
  const limit = Math.min(maxLagSamples, Math.floor(n / 2));

  for (let lag = 0; lag <= limit; lag += 1) {
    const count = n - lag;
    let refMean = 0;
    let resMean = 0;
    for (let i = 0; i < count; i += 1) {
      refMean += reference[i] as number;
      resMean += response[i + lag] as number;
    }
    refMean /= count;
    resMean /= count;

    let cov = 0;
    let refVar = 0;
    let resVar = 0;
    for (let i = 0; i < count; i += 1) {
      const a = (reference[i] as number) - refMean;
      const b = (response[i + lag] as number) - resMean;
      cov += a * b;
      refVar += a * a;
      resVar += b * b;
    }
    if (refVar === 0 || resVar === 0) continue;

    const value = cov / Math.sqrt(refVar * resVar);
    if (value > best) {
      best = value;
      bestLag = lag;
    }
  }
  return bestLag;
}

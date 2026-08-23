import type { ResponseCurve } from "@/core/recommendation";

/**
 * The response curve — the evidence chart (doc 25 §25.9, FR-083).
 *
 * The most important pixel-work in the product, and deliberately **not** a bar chart: a bar
 * chart implies "the winner", which invites over-interpretation of a small difference. A curve
 * with a band shows the *shape* of the answer — including when the shape is flat, which is
 * exactly the honesty an `indistinguishable` verdict needs.
 *
 *  - x: cm/360, **log-scaled**. The search space is logarithmic; a linear axis would distort
 *    the curve's symmetry and misrepresent the fit.
 *  - y: relative performance, **unlabelled numerically**. The units are standardised score and
 *    a number there would invite false interpretation. Labelled "worse ←→ better".
 *  - Each candidate: a dot with a ±1 SE error bar, sized by sample count; the anchor distinct.
 *  - The fitted curve with the bootstrap band as a soft fill; the peak as a vertical line; the
 *    comfort range as a bracket under the axis; the player's current sensitivity marked; the
 *    physical constraint, if binding, as a shaded forbidden region.
 *
 * Server-rendered SVG: no client code, no animation, theme tokens only. Hover detail is a
 * `<title>` per dot, which screen readers and pointers both reach.
 */

const WIDTH = 760;
const HEIGHT = 360;
const PAD = { left: 28, right: 28, top: 24, bottom: 64 };

function niceTicks(lo: number, hi: number): number[] {
  const candidates = [5, 8, 10, 12, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100, 120, 150];
  return candidates.filter((value) => value >= lo * 0.98 && value <= hi * 1.02);
}

export function ResponseCurveChart({ curve, verdict }: { curve: ResponseCurve; verdict: string }) {
  const usable = curve.candidates.filter((c) => Number.isFinite(c.cm360) && c.cm360 > 0);
  if (usable.length === 0) return null;

  const cms = usable.map((c) => c.cm360);
  const extra = [
    curve.comfortBand.lo,
    curve.comfortBand.hi,
    curve.currentSens?.cm360 ?? NaN,
  ].filter((v) => Number.isFinite(v) && v > 0);
  const xLo = Math.min(...cms, ...extra) / 1.15;
  const xHi = Math.max(...cms, ...extra) * 1.15;

  const ys = usable.flatMap((c) => [c.alphaHat - c.se, c.alphaHat + c.se]);
  const bandYs = curve.band.flatMap((b) => [b.lo, b.hi]);
  const yMin = Math.min(...ys, ...bandYs);
  const yMax = Math.max(...ys, ...bandYs);
  const ySpan = Math.max(1e-6, yMax - yMin);
  const yLo = yMin - ySpan * 0.2;
  const yHi = yMax + ySpan * 0.2;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (cm: number): number =>
    PAD.left + ((Math.log(cm) - Math.log(xLo)) / (Math.log(xHi) - Math.log(xLo))) * plotW;
  const y = (value: number): number => PAD.top + (1 - (value - yLo) / (yHi - yLo)) * plotH;
  const axisY = PAD.top + plotH;

  // The fitted curve, sampled in log space across the plot.
  const fitPath =
    curve.fit === null
      ? null
      : Array.from({ length: 61 }, (_, i) => {
          const cm = Math.exp(Math.log(xLo) + ((Math.log(xHi) - Math.log(xLo)) * i) / 60);
          const xLog2 = Math.log2((cm * curve.dpi) / 2.54);
          const fit = curve.fit as NonNullable<ResponseCurve["fit"]>;
          const value = fit.b0 + fit.b1 * xLog2 + fit.b2 * xLog2 * xLog2;
          return `${i === 0 ? "M" : "L"}${x(cm).toFixed(1)},${y(Math.min(yHi, Math.max(yLo, value))).toFixed(1)}`;
        }).join(" ");

  const bandPath =
    curve.band.length < 2
      ? null
      : [
          ...curve.band.map(
            (b, i) => `${i === 0 ? "M" : "L"}${x(b.cm360).toFixed(1)},${y(b.hi).toFixed(1)}`,
          ),
          ...[...curve.band]
            .reverse()
            .map((b) => `L${x(b.cm360).toFixed(1)},${y(b.lo).toFixed(1)}`),
          "Z",
        ].join(" ");

  const maxN = Math.max(...usable.map((c) => c.n), 1);
  const ticks = niceTicks(xLo, xHi);
  const peakLabel = curve.xStar === null ? null : `${curve.xStar.cm360.toFixed(1)}`;

  return (
    <figure className="w-full overflow-x-auto" data-testid="response-curve">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby="response-curve-title response-curve-desc"
        className="h-auto w-full min-w-[520px]"
      >
        <title id="response-curve-title">Your response curve</title>
        <desc id="response-curve-desc">
          {`Performance at each tested sensitivity, ${usable.length} candidates, ${
            verdict === "peak_found" && peakLabel !== null
              ? `peaking at ${peakLabel} cm per 360 degrees`
              : "with no single sensitivity clearly ahead"
          }. Comfort range ${curve.comfortBand.lo.toFixed(1)} to ${curve.comfortBand.hi.toFixed(1)} cm.`}
        </desc>

        {/* Forbidden region beyond the physical constraint. */}
        {curve.constraint !== null && curve.constraint.maxCm360 < xHi && (
          <rect
            x={x(Math.max(xLo, curve.constraint.maxCm360))}
            y={PAD.top}
            width={Math.max(0, PAD.left + plotW - x(Math.max(xLo, curve.constraint.maxCm360)))}
            height={plotH}
            fill="var(--color-critical)"
            opacity="0.08"
          />
        )}

        {/* Comfort bracket under the axis. */}
        <g data-testid="comfort-band">
          <rect
            x={x(curve.comfortBand.lo)}
            y={PAD.top}
            width={Math.max(0, x(curve.comfortBand.hi) - x(curve.comfortBand.lo))}
            height={plotH}
            fill="var(--color-accent)"
            opacity="0.05"
          />
          <line
            x1={x(curve.comfortBand.lo)}
            x2={x(curve.comfortBand.hi)}
            y1={axisY + 26}
            y2={axisY + 26}
            stroke="var(--color-accent)"
            strokeWidth="1.5"
          />
          <line
            x1={x(curve.comfortBand.lo)}
            x2={x(curve.comfortBand.lo)}
            y1={axisY + 21}
            y2={axisY + 31}
            stroke="var(--color-accent)"
            strokeWidth="1.5"
          />
          <line
            x1={x(curve.comfortBand.hi)}
            x2={x(curve.comfortBand.hi)}
            y1={axisY + 21}
            y2={axisY + 31}
            stroke="var(--color-accent)"
            strokeWidth="1.5"
          />
          <text
            x={(x(curve.comfortBand.lo) + x(curve.comfortBand.hi)) / 2}
            y={axisY + 44}
            textAnchor="middle"
            fontSize="10"
            fill="var(--color-accent)"
            fontFamily="var(--font-mono)"
          >
            COMFORT RANGE
          </text>
        </g>

        {/* Bootstrap band. */}
        {bandPath !== null && (
          <path d={bandPath} fill="var(--color-text-2)" opacity="0.12" data-testid="fit-band" />
        )}

        {/* Fitted curve. */}
        {fitPath !== null && (
          <path
            d={fitPath}
            fill="none"
            stroke="var(--color-text-1)"
            strokeWidth="1.5"
            data-testid="fit-curve"
          />
        )}

        {/* Axis. */}
        <line
          x1={PAD.left}
          x2={PAD.left + plotW}
          y1={axisY}
          y2={axisY}
          stroke="var(--color-hairline-strong)"
        />
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={x(tick)}
              x2={x(tick)}
              y1={axisY}
              y2={axisY + 5}
              stroke="var(--color-hairline-strong)"
            />
            <text
              x={x(tick)}
              y={axisY + 16}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-text-3)"
              fontFamily="var(--font-mono)"
            >
              {tick}
            </text>
          </g>
        ))}
        <text
          x={PAD.left + plotW}
          y={axisY + 16}
          textAnchor="end"
          fontSize="10"
          fill="var(--color-text-3)"
          fontFamily="var(--font-mono)"
          dx="-2"
          dy="12"
        >
          cm / 360°
        </text>
        <text
          x={PAD.left - 4}
          y={PAD.top + 8}
          fontSize="10"
          fill="var(--color-text-3)"
          fontFamily="var(--font-mono)"
          transform={`rotate(-90 ${PAD.left - 4} ${PAD.top + 8})`}
          textAnchor="end"
        >
          worse ← → better
        </text>

        {/* The player's own sensitivity. Labelled at the foot of the plot, where the peak label
            (at the head) cannot collide with it when the two are close — which they often are. */}
        {curve.currentSens !== null && (
          <g data-testid="current-sens">
            <line
              x1={x(curve.currentSens.cm360)}
              x2={x(curve.currentSens.cm360)}
              y1={PAD.top}
              y2={axisY}
              stroke="var(--color-text-3)"
              strokeDasharray="3 4"
            />
            <text
              x={x(curve.currentSens.cm360)}
              y={axisY - 8}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-text-3)"
              fontFamily="var(--font-mono)"
            >
              YOU WERE HERE
            </text>
          </g>
        )}

        {/* The peak. */}
        {curve.xStar !== null && (
          <g data-testid="peak-marker">
            <rect
              x={x(curve.xStar.ciLow)}
              y={PAD.top}
              width={Math.max(0, x(curve.xStar.ciHigh) - x(curve.xStar.ciLow))}
              height={plotH}
              fill="var(--color-result)"
              opacity="0.08"
            />
            <line
              x1={x(curve.xStar.cm360)}
              x2={x(curve.xStar.cm360)}
              y1={PAD.top}
              y2={axisY}
              stroke="var(--color-result)"
              strokeWidth="1.5"
            />
            <text
              x={x(curve.xStar.cm360)}
              y={PAD.top - 6}
              textAnchor="middle"
              fontSize="11"
              fill="var(--color-result)"
              fontFamily="var(--font-mono)"
            >
              {peakLabel}
            </text>
          </g>
        )}

        {/* Candidates. */}
        {usable.map((c) => {
          const radius = 3 + 4 * Math.sqrt(c.n / maxN);
          const colour = c.insufficient
            ? "var(--color-text-3)"
            : c.isAnchor
              ? "var(--color-result)"
              : "var(--color-accent)";
          return (
            <g key={`${c.roundIndex}:${c.blindLabel}:${c.cm360}`} data-testid="candidate-dot">
              <title>{`${c.cm360.toFixed(1)} cm/360 · ${c.n} trials · round ${c.roundIndex + 1} · shown as ${c.blindLabel}${c.isAnchor ? " · anchor re-test" : ""}${c.insufficient ? " · below the sample floor" : ""}`}</title>
              <line
                x1={x(c.cm360)}
                x2={x(c.cm360)}
                y1={y(c.alphaHat - c.se)}
                y2={y(c.alphaHat + c.se)}
                stroke={colour}
                strokeWidth="1"
              />
              {c.isAnchor ? (
                <rect
                  x={x(c.cm360) - radius}
                  y={y(c.alphaHat) - radius}
                  width={radius * 2}
                  height={radius * 2}
                  fill="var(--color-surface)"
                  stroke={colour}
                  strokeWidth="1.5"
                  transform={`rotate(45 ${x(c.cm360)} ${y(c.alphaHat)})`}
                />
              ) : (
                <circle
                  cx={x(c.cm360)}
                  cy={y(c.alphaHat)}
                  r={radius}
                  fill="var(--color-surface)"
                  stroke={colour}
                  strokeWidth="1.5"
                />
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-3 max-w-[72ch] text-sm text-text-3">
        Each dot is one sensitivity you tested, with its error bar and sized by how many trials it
        had. The curve is fitted to your results; the band is how sure we are about the curve. A
        diamond is the anchor re-test. No sensitivity is labelled until this page: you saw letters.
      </figcaption>
    </figure>
  );
}

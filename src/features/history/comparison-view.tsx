import Link from "next/link";
import { Callout, Panel } from "@/components/primitives";
import { dimensionLabel } from "@/core/recommendation";
import { DIFFERENCE_COPY, type ComparisonView } from "@/services/history-service";

/**
 * SCR-042 — Session comparison (doc 17 §17.9, FR-093, `SENS-BR-019`).
 *
 * The comparability flag comes first, because everything below it is only interpretable once
 * the reader knows whether the two sessions are measuring the same thing. When the ranges
 * overlap the page says the change is within the noise of the method — in those words, in the
 * headline position, rather than as a footnote under a large number.
 */

const fmt = (value: number | null, decimals = 1): string =>
  value === null ? "—" : value.toFixed(decimals);

const dateOf = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * A displayed delta, signed. Rounding first is what keeps a change of −0.4 from rendering as
 * "−0": at display precision it did not move, and a minus sign in front of nothing reads as a
 * decline that was never measured.
 */
function signed(delta: number | null): string {
  if (delta === null) return "—";
  const rounded = Math.round(delta);
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}`;
}

export function SessionComparison({ view }: { view: ComparisonView }) {
  const { a, b, change } = view;

  return (
    <main id="main" className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-6 py-12">
      <header>
        <span className="type-label">Comparison</span>
        <h1 className="type-display-s" data-testid="comparison-headline">
          {change.verdict === "meaningful"
            ? "A MEASURABLE CHANGE"
            : change.verdict === "within_noise"
              ? "WITHIN THE NOISE OF THE METHOD"
              : "NOTHING TO COMPARE"}
        </h1>
      </header>

      {!view.comparability.comparable && (
        <Callout tone="caution" title="These two sessions are not directly comparable">
          <span data-testid="comparability-flag">
            They used{" "}
            {view.comparability.differences
              .map((difference) => DIFFERENCE_COPY[difference])
              .join(", ")}
            . The numbers below are still what each session measured, but a difference between them
            is not a change in you.
          </span>
        </Callout>
      )}

      {/* ------------------------------------------------------------ headline */}
      <section
        className="flex flex-wrap items-baseline gap-x-10 gap-y-3"
        data-testid="comparison-arms"
      >
        <div>
          <p className="type-label text-text-3">{dateOf(a.startedAt)}</p>
          <p className="type-data-l">
            {fmt(a.recommendedCm360)} <span className="type-label text-text-3">cm/360</span>
          </p>
          <p className="text-xs text-text-3">
            {a.highPerformance === null
              ? "no high-performance range"
              : `${fmt(a.highPerformance.low)} — ${fmt(a.highPerformance.high)}`}
          </p>
        </div>
        <span className="type-label text-text-3">→</span>
        <div>
          <p className="type-label text-text-3">{dateOf(b.startedAt)}</p>
          <p className="type-data-l">
            {fmt(b.recommendedCm360)} <span className="type-label text-text-3">cm/360</span>
          </p>
          <p className="text-xs text-text-3">
            {b.highPerformance === null
              ? "no high-performance range"
              : `${fmt(b.highPerformance.low)} — ${fmt(b.highPerformance.high)}`}
          </p>
        </div>
      </section>

      <p className="max-w-[68ch] text-text-2" data-testid="change-statement">
        {change.verdict === "not_available" ? (
          <>
            One of these sessions did not produce a single recommended value, so there is no change
            to state. Each session&rsquo;s own range is above.
          </>
        ) : change.verdict === "meaningful" ? (
          <>
            Your recommendation moved from {fmt(change.fromCm360)} to {fmt(change.toCm360)} cm/360 —
            about {Math.abs(Math.round(change.percent ?? 0))}%{" "}
            {change.direction === "slower" ? "slower" : "faster"}. The two high-performance ranges
            do not overlap, which is the point at which this method is willing to call a change
            real.
          </>
        ) : (
          <>
            Your recommendation moved from {fmt(change.fromCm360)} to {fmt(change.toCm360)} cm/360,
            but the two measurements&rsquo; ranges overlap — this is within the noise of the method,
            not a demonstrated change.
          </>
        )}
      </p>

      {/* ------------------------------------------------------------ what differed */}
      <Panel title="Side by side">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse" data-testid="comparison-table">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="py-2 type-label text-text-3">Field</th>
                <th className="py-2 type-label text-text-3">{dateOf(a.startedAt)}</th>
                <th className="py-2 type-label text-text-3">{dateOf(b.startedAt)}</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Mode", a: a.mode, b: b.mode },
                { label: "Game", a: a.gameName ?? "—", b: b.gameName ?? "—" },
                { label: "DPI", a: String(a.dpi ?? "—"), b: String(b.dpi ?? "—") },
                {
                  label: "Hardware",
                  a: a.hardwareProfileName ?? "ad-hoc",
                  b: b.hardwareProfileName ?? "ad-hoc",
                },
                { label: "Environment", a: a.environmentClass, b: b.environmentClass },
                {
                  label: "Confidence",
                  a: String(view.confidence.from ?? "—"),
                  b: String(view.confidence.to ?? "—"),
                },
                {
                  label: "Aim profile",
                  a: a.aimProfileName ?? "—",
                  b: b.aimProfileName ?? "—",
                },
                {
                  label: "Quality flags",
                  a: a.qualityFlags.length === 0 ? "none" : a.qualityFlags.join(", "),
                  b: b.qualityFlags.length === 0 ? "none" : b.qualityFlags.join(", "),
                },
                {
                  label: "Algorithm",
                  a: a.versions.calibration ?? "—",
                  b: b.versions.calibration ?? "—",
                },
              ].map((row) => (
                <tr key={row.label} className="border-b border-hairline">
                  <td className="py-2 type-label text-text-3">{row.label}</td>
                  <td className="py-2 type-data-s">{row.a}</td>
                  <td className="py-2 type-data-s">{row.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ------------------------------------------------------------ dimensions */}
      {view.dimensions.length > 0 && (
        <Panel title="Dimension scores">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse" data-testid="dimension-table">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th className="py-2 type-label text-text-3">Dimension</th>
                  <th className="py-2 type-label text-text-3">Then</th>
                  <th className="py-2 type-label text-text-3">Now</th>
                  <th className="py-2 type-label text-text-3">Change</th>
                  <th className="py-2 type-label text-text-3">Reading</th>
                </tr>
              </thead>
              <tbody>
                {view.dimensions.map((dimension) => (
                  <tr
                    key={dimension.dimension}
                    className="border-b border-hairline"
                    data-testid={`dimension-${dimension.dimension}`}
                  >
                    <td className="py-2 type-label">{dimensionLabel(dimension.dimension)}</td>
                    <td className="py-2 type-data-s">{fmt(dimension.from, 0)}</td>
                    <td className="py-2 type-data-s">{fmt(dimension.to, 0)}</td>
                    <td className="py-2 type-data-s">{signed(dimension.delta)}</td>
                    <td className="py-2 text-sm">
                      {dimension.delta === null ? (
                        <span className="text-text-3">not scored in both</span>
                      ) : dimension.meaningful ? (
                        <span>outside the noise</span>
                      ) : (
                        <span className="text-text-3">within noise</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-text-3">
            A dimension change is called meaningful only when it exceeds the sampling error of both
            sessions at the {Math.round(view.level * 100)}% level. Scores are on a provisional
            scale, so a delta is a within-you comparison and never a percentile.
          </p>
        </Panel>
      )}

      {view.profileChanged && (
        <Callout tone="neutral" title="Your aim profile is classified differently">
          <span data-testid="profile-changed">
            {a.aimProfileName} then, {b.aimProfileName} now. The profile is a description of which
            dimensions stood out relative to your own average in each session — a change in it
            follows from the dimension changes above, and is only as meaningful as they are.
          </span>
        </Callout>
      )}

      <div className="flex flex-wrap gap-4">
        <Link href="/history" className="type-label underline">
          Back to history
        </Link>
        {a.recommendationId !== null && (
          <Link href={`/results/${a.recommendationId}`} className="type-label underline">
            Open the earlier result
          </Link>
        )}
        {b.recommendationId !== null && (
          <Link href={`/results/${b.recommendationId}`} className="type-label underline">
            Open the later result
          </Link>
        )}
      </div>
    </main>
  );
}

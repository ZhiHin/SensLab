import { dimensionLabel } from "@/core/recommendation";
import type { DimensionKey } from "@/core/types/vocabulary";

/**
 * Aim DNA — the profile shape (doc 25 §25.9, FR-082).
 *
 * Not a filled radar polygon. Each of the six axes carries a **band of fine tick marks**:
 * the band's centre radius is the dimension score, its width is the dimension's uncertainty,
 * and its tick density is the sample size. Three quantities per axis where a radar encodes
 * one — and uncertainty becomes a visual property rather than a footnote: a dimension fed by
 * few trials is visibly fuzzy.
 *
 * Server-rendered SVG; the reveal animation is a CSS transition on the dash offset, which
 * `prefers-reduced-motion` disables in the stylesheet. Scores are marked PROVISIONAL while the
 * reference distribution is (doc 14 §14.4).
 */

export interface AimDnaDimension {
  readonly dimension: string;
  readonly score: number;
  readonly shape: number;
  readonly n: number;
  readonly provisional: boolean;
}

const SIZE = 360;
const CENTRE = SIZE / 2;
const R_MIN = 28;
const R_MAX = 150;
/** Trials at which the band reaches its narrowest. */
const N_SATURATION = 60;

const ORDER: readonly DimensionKey[] = [
  "flick",
  "precision",
  "tracking",
  "speed",
  "control",
  "consistency",
];

export function AimDna({ dimensions }: { dimensions: readonly AimDnaDimension[] }) {
  const byKey = new Map(dimensions.map((d) => [d.dimension, d]));
  const provisional = dimensions.some((d) => d.provisional);
  const angleFor = (index: number): number => -Math.PI / 2 + (index * 2 * Math.PI) / ORDER.length;
  const radiusFor = (score: number): number =>
    R_MIN + ((R_MAX - R_MIN) * Math.max(0, Math.min(100, score))) / 100;

  return (
    <figure className="flex flex-col items-center" data-testid="aim-dna">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-labelledby="aim-dna-title aim-dna-desc"
        className="h-auto w-full max-w-[360px]"
      >
        <title id="aim-dna-title">Aim DNA</title>
        <desc id="aim-dna-desc">
          {ORDER.map((key) => {
            const d = byKey.get(key);
            return d === undefined || d.n === 0
              ? `${dimensionLabel(key)} not measured`
              : `${dimensionLabel(key)} ${Math.round(d.score)} from ${d.n} trials`;
          }).join(", ")}
          {provisional ? ". Scores are provisional." : "."}
        </desc>

        {/* Reference rings at 25/50/75/100. */}
        {[25, 50, 75, 100].map((level) => (
          <circle
            key={level}
            cx={CENTRE}
            cy={CENTRE}
            r={radiusFor(level)}
            fill="none"
            stroke="var(--color-hairline)"
            strokeWidth="1"
          />
        ))}

        {ORDER.map((key, index) => {
          const angle = angleFor(index);
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const d = byKey.get(key);
          const measured = d !== undefined && d.n > 0;

          const labelR = R_MAX + 22;
          const axis = (
            <line
              x1={CENTRE}
              y1={CENTRE}
              x2={CENTRE + cos * R_MAX}
              y2={CENTRE + sin * R_MAX}
              stroke="var(--color-hairline-strong)"
              strokeWidth="1"
            />
          );
          const label = (
            <text
              x={CENTRE + cos * labelR}
              y={CENTRE + sin * labelR + 4}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-text-3)"
              fontFamily="var(--font-mono)"
            >
              {dimensionLabel(key).toUpperCase()}
            </text>
          );

          if (!measured || d === undefined) {
            return (
              <g key={key} data-testid={`dna-axis-${key}`} data-measured="false">
                {axis}
                {label}
              </g>
            );
          }

          // Band width shrinks with sample size; tick density grows with it.
          const saturation = Math.min(1, d.n / N_SATURATION);
          const halfWidth = 4 + (1 - saturation) * 18;
          const ticks = 3 + Math.round(saturation * 12);
          const centreR = radiusFor(d.score);
          const perpX = -sin;
          const perpY = cos;

          return (
            <g
              key={key}
              data-testid={`dna-axis-${key}`}
              data-measured="true"
              className="aim-dna-band"
            >
              {axis}
              {label}
              {Array.from({ length: ticks }, (_, t) => {
                const r = centreR - halfWidth + (2 * halfWidth * t) / Math.max(1, ticks - 1);
                const cx = CENTRE + cos * r;
                const cy = CENTRE + sin * r;
                const half = 6;
                return (
                  <line
                    key={t}
                    x1={cx - perpX * half}
                    y1={cy - perpY * half}
                    x2={cx + perpX * half}
                    y2={cy + perpY * half}
                    stroke="var(--color-accent)"
                    strokeWidth="1.25"
                    opacity={0.45 + 0.55 * (1 - Math.abs(t / Math.max(1, ticks - 1) - 0.5) * 2)}
                  />
                );
              })}
              <circle
                cx={CENTRE + cos * centreR}
                cy={CENTRE + sin * centreR}
                r="3"
                fill="var(--color-accent)"
              />
              <text
                x={CENTRE + cos * (centreR + 14)}
                y={CENTRE + sin * (centreR + 14) + 4}
                textAnchor="middle"
                fontSize="11"
                fill="var(--color-text-1)"
                fontFamily="var(--font-mono)"
              >
                {Math.round(d.score)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-col items-center gap-1 text-center text-sm text-text-3">
        <span>Radius is the score. Band width is uncertainty. Tick density is sample size.</span>
        {provisional && (
          <span className="type-label" data-testid="provisional-label">
            Scores are provisional — no population reference exists yet, so no percentiles.
          </span>
        )}
      </figcaption>
    </figure>
  );
}

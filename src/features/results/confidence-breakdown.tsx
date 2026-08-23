import type { ConfidenceComponent, ConfidenceComponentKey } from "@/core/confidence";

/**
 * The confidence breakdown (doc 15 §15.6).
 *
 * Every component with its name in plain language, its value, one sentence on what it
 * measured, and — for the largest contributor to a reduced score — a concrete action. This is
 * what turns "79 / 100" from a mysterious number into a diagnostic (`SENS-BR-027`), and it is
 * why the wording everywhere is "confidence index", never "X% chance".
 */

const COPY: Readonly<
  Record<ConfidenceComponentKey, { label: string; measured: string; action: string }>
> = {
  peak: {
    label: "Peak identification",
    measured: "How tightly your data pin down where the peak is.",
    action: "Run a Standard or Advanced session: more rounds narrow the interval.",
  },
  sample: {
    label: "Sample size",
    measured: "How many valid trials you completed against the session's target.",
    action:
      "Complete every round without stopping early; invalid trials are replaced but count for less.",
  },
  consistency: {
    label: "Your consistency",
    measured: "How repeatable your trials were. A real property of the session, not a fault.",
    action: "Calibrate when warmed up and rested; variance is the honest limiter for many players.",
  },
  environment: {
    label: "Environment",
    measured: "Raw input, frame timing, pointer-lock stability and window size during the session.",
    action: "Enable raw input, close background applications, and keep the window fixed.",
  },
  drift: {
    label: "Warm-up and fatigue",
    measured: "How much your performance trended over the session, independent of sensitivity.",
    action: "Warm up before calibrating and take the between-round pauses.",
  },
  fit: {
    label: "Curve fit",
    measured: "How well a single peak describes your results across the sensitivities tested.",
    action: "More distinct sensitivities (Standard or Advanced) give the fit more to work with.",
  },
  anchor: {
    label: "Repeatability check",
    measured: "Whether re-testing a sensitivity late in the session matched its early result.",
    action: "Quick mode skips this check; Standard and Advanced run it.",
  },
};

export function ConfidenceBreakdown({
  index,
  components,
  verdictCapped,
  ceiling,
  indistinguishable,
}: {
  index: number;
  components: readonly ConfidenceComponent[];
  verdictCapped: boolean;
  ceiling: number;
  indistinguishable: boolean;
}) {
  // Blame is allocated the way the geometric mean allocates it: weighted log-loss.
  let worst: ConfidenceComponent | null = null;
  let worstLoss = 0;
  for (const component of components) {
    const loss = -component.weight * Math.log(Math.max(1e-6, component.value));
    if (loss > worstLoss) {
      worstLoss = loss;
      worst = component;
    }
  }

  return (
    <details className="border border-hairline" data-testid="confidence-breakdown">
      <summary className="cursor-pointer list-none px-5 py-4 type-label">
        What does {index} / 100 mean?
      </summary>
      <div className="flex flex-col gap-4 border-t border-hairline px-5 py-4">
        <p className="max-w-[68ch] text-sm text-text-2">
          The confidence index is a quality score for this session, not a probability and not a
          percentage of anything. It is a weighted geometric mean of seven measured components, so
          one poor component drags the whole index down rather than hiding behind the others. The
          maximum for this version is {Math.round(ceiling * 100)}: until the index has been checked
          against repeat sessions, claiming more would assert a precision we have not demonstrated.
        </p>
        {indistinguishable && (
          <p className="max-w-[68ch] text-sm text-caution" data-testid="verdict-cap-note">
            {verdictCapped ? "Capped: " : ""}No single sensitivity clearly won, so the index cannot
            exceed 40 however clean the session was
            {verdictCapped ? " — and here it would have" : ""}. A well-run session must not lend
            credibility to a result that has no peak in it.
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {components.map((component) => {
            const copy = COPY[component.key];
            const isWorst = worst?.key === component.key && component.value < 0.9;
            return (
              <li
                key={component.key}
                className="flex flex-col gap-1 border-b border-hairline pb-3 last:border-b-0"
                data-testid={`confidence-${component.key}`}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="type-label text-text-1">{copy.label}</span>
                  <span className="type-data-s text-text-1">
                    {Math.round(component.value * 100)}
                    <span className="ml-1 text-text-3">/ 100</span>
                    {component.neutral && (
                      <span className="ml-2 type-label text-text-3">not measured</span>
                    )}
                    {component.capped && (
                      <span className="ml-2 type-label text-caution">capped</span>
                    )}
                  </span>
                </div>
                <p className="text-sm text-text-3">{copy.measured}</p>
                {isWorst && (
                  <p className="text-sm text-text-2" data-testid="confidence-action">
                    Largest detractor. {copy.action}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { ADVANCED_TESTS, MVP_TESTS } from "@/test-engine/tests";
import { copyFor } from "@/features/test-run/copy";

/**
 * The test index (Phase 3).
 *
 * Each MVP test can be run on its own. That is Phase 3's deliverable and its limit: running one
 * test measures how you perform at *one* sensitivity, which is not a comparison and therefore
 * not a recommendation. The calibration session that compares several is Phase 4, and saying so
 * plainly is better than implying this page does more than it does.
 */
export const metadata: Metadata = {
  title: "Aim tests",
  description: "Run an individual SensLab aim test.",
};

export default function TestIndexPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-[860px] px-6 py-12">
      <header className="mb-8 flex flex-col gap-2">
        <span className="type-label">Phase 3 · Aim tests</span>
        <h1 className="type-display-s">THE BATTERY</h1>
        <p className="max-w-[62ch] text-text-2">
          Seven tests. Five of them measure aim in a way that responds to sensitivity; the other two
          measure something deliberately independent of it — your reaction floor, and how far you
          can physically turn.
        </p>
        <p className="max-w-[62ch] text-sm text-text-3">
          Running a single test records your trials, but it cannot recommend a sensitivity. A
          recommendation needs several sensitivities compared against each other, which is what a
          full calibration session does.
        </p>
      </header>

      <TestList tests={MVP_TESTS} />

      <h2 className="type-label mt-10 mb-3">Advanced tests</h2>
      <p className="mb-4 max-w-[62ch] text-sm text-text-3">
        Six more tests that add resolution rather than capability: large turns, unpredictable and
        high-speed tracking, pure speed, recoil control against a generated pattern, and aiming
        through a simulated scope. Advanced sessions run them; here each runs alone.
      </p>
      <TestList tests={ADVANCED_TESTS} />
    </main>
  );
}

function TestList({ tests }: { tests: readonly (typeof MVP_TESTS)[number][] }) {
  return (
    <ul className="flex flex-col gap-3">
      {tests.map((definition) => {
        const copy = copyFor(definition);
        return (
          <li key={definition.key}>
            <Link
              href={`/test/${definition.key}`}
              className="flex flex-col gap-1 border border-hairline p-5 hover:border-text-3"
              data-testid={`test-link-${definition.key}`}
            >
              <span className="flex items-baseline justify-between gap-4">
                <span className="type-label">{copy.name}</span>
                <span className="type-label text-text-3" data-category={definition.category}>
                  {definition.category === "scored"
                    ? "scored"
                    : definition.category === "baseline"
                      ? "baseline · not scored"
                      : "constraint · not scored"}
                </span>
              </span>
              <span className="text-sm text-text-2">{copy.summary}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

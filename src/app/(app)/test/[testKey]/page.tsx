import type { Metadata } from "next";
import { TestSurface } from "@/features/test-run/test-surface";
import { copyFor } from "@/features/test-run/copy";
import { getTestDefinition } from "@/test-engine/tests";

/**
 * One aim test (doc 04 stage 7).
 *
 * The sensitivity and the plausibility bound are passed in from here rather than chosen by the
 * client. A Phase 4 session derives them from the player's hardware profile; a single-test run
 * has no profile, so it uses the documented bracket centre and the permissive default bound —
 * stated plainly rather than presented as a measurement.
 */

/** doc 09 §9.0.6 — the bracket centre, ~30 cm/360 at 800 DPI. */
const BRACKET_CENTRE_COUNTS_PER_360 = 9448.82;
/** doc 23 §23.10 — the permissive default until a real DPI is known. */
const DEFAULT_MAX_COUNTS_PER_SECOND = 4_000_000;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ testKey: string }>;
}): Promise<Metadata> {
  const { testKey } = await params;
  const definition = getTestDefinition(testKey);
  if (definition === undefined) return { title: "Unknown test" };
  return { title: copyFor(definition).name };
}

export default async function TestPage({ params }: { params: Promise<{ testKey: string }> }) {
  const { testKey } = await params;

  return (
    <TestSurface
      testKey={testKey}
      countsPer360={BRACKET_CENTRE_COUNTS_PER_360}
      maxImpliedCountsPerSecond={DEFAULT_MAX_COUNTS_PER_SECOND}
    />
  );
}

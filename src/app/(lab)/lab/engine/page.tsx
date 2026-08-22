import type { Metadata } from "next";
import { EngineHarness } from "@/features/lab/engine-harness";

/**
 * The aim-engine browser harness (doc 19 §19.12, harness 3).
 *
 * Development only: the `(lab)` layout returns 404 for this route in a production build.
 */
export const metadata: Metadata = {
  title: "Aim engine harness",
  robots: { index: false, follow: false },
};

export default function EngineHarnessPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-[1100px] px-6 py-12">
      <EngineHarness />
    </main>
  );
}

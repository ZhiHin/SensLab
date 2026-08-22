import { notFound } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The lab route group — development only.
 *
 * Everything under `(lab)` is an engineering harness, not a product surface. It exists so the
 * engine can be driven in a real browser with real pointer lock, a real canvas and a real
 * requestAnimationFrame, which the headless harness deliberately cannot do (doc 19 §19.12).
 *
 * The guard below is a server-side `notFound()` rather than a link that is merely hidden: in a
 * production build these routes return 404 before any client code is sent. A harness that
 * shipped would let anyone run a session against a synthetic definition and would put an
 * unreviewed surface in front of real users.
 */
export default function LabLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return <>{children}</>;
}

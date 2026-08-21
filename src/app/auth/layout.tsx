import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Minimal chrome for the authentication screens (doc 24 §24.6): logo and an exit route,
 * nothing else. These pages have one job.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh">
      <div className="instrument-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="instrument-noise pointer-events-none absolute inset-0" aria-hidden="true" />

      <header className="relative flex items-center justify-between border-b border-hairline px-6 py-4">
        <Link href="/" className="type-label text-text-1">
          SENSLAB
        </Link>
        <Link href="/" className="type-label">
          Exit
        </Link>
      </header>

      <main id="main" className="relative mx-auto w-full max-w-[440px] px-6 py-16">
        {children}
      </main>
    </div>
  );
}

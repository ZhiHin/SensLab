import Link from "next/link";
import type { Metadata } from "next";

/**
 * The 404 (doc 26, doc 28 §28.6).
 *
 * Reached both by an unknown URL and by every `notFound()` in the app — which is how a result,
 * a session or a hardware profile that belongs to somebody else is refused. That second route
 * is the important one: an owner-scoped lookup returns null and the page 404s, so this screen
 * must say the same thing whether the id never existed or simply is not the reader's. Any
 * wording that distinguished them would turn the 404 into an existence oracle
 * (`SENS-SEC-010`).
 */

export const metadata: Metadata = {
  title: "Not found — SensLab",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main
      id="main"
      className="flex min-h-[70vh] flex-col items-start justify-center gap-6 px-6 py-20"
    >
      <div className="mx-auto w-full max-w-[720px]">
        <p className="type-label text-text-3">404</p>
        <h1 className="mt-4 type-display-m text-text-1">NOTHING HERE.</h1>
        <p className="mt-6 max-w-[52ch] text-text-2">
          This page does not exist, or it belongs to somebody else. Either way there is nothing here
          for you.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-6">
          <Link
            href="/"
            className="border border-hairline px-6 py-3 type-label text-text-1 transition-colors duration-[var(--duration-micro)] hover:border-accent hover:text-accent"
          >
            Back to the start
          </Link>
          <Link href="/history" className="type-label text-text-3 hover:text-text-1">
            Your sessions →
          </Link>
        </div>
      </div>
    </main>
  );
}

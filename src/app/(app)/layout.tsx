import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/features/auth/actions";
import { getActor } from "@/services/session-context";

/**
 * The signed-in shell for the product surfaces.
 *
 * Deliberately slim: a link bar, not a dashboard. Phase 9 needs the account screens to be
 * reachable at all — FR-090's history is not a feature if it has no route to it — and the
 * landing and navigation design is Phase 10's work.
 *
 * The bar renders nothing about the account for a guest beyond the way in, because a guest's
 * work lives in a cookie and there is nothing to link to.
 */

const link = "type-label text-text-3 hover:text-text-1";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  const signedIn = actor.kind === "user";

  return (
    <>
      <nav
        className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-hairline px-6 py-3"
        aria-label="Account"
        data-testid="app-nav"
      >
        <Link href="/" className="type-label text-text-1">
          SensLab
        </Link>
        <Link href="/calibrate" className={link} data-testid="nav-calibrate">
          Calibrate
        </Link>
        {signedIn && (
          <>
            <Link href="/history" className={link} data-testid="nav-history">
              History
            </Link>
            <Link href="/hardware-profiles" className={link} data-testid="nav-hardware">
              Hardware
            </Link>
          </>
        )}
        <span className="flex flex-1 items-center justify-end gap-x-6">
          {signedIn ? (
            <>
              <Link href="/profile" className={link} data-testid="nav-profile">
                Profile
              </Link>
              <Link href="/settings" className={link} data-testid="nav-settings">
                Settings
              </Link>
              <form action={signOutAction}>
                <button type="submit" className={link} data-testid="nav-sign-out">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link href="/auth/sign-in" className={link} data-testid="nav-sign-in">
              Sign in
            </Link>
          )}
        </span>
      </nav>
      {children}
    </>
  );
}

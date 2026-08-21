import Link from "next/link";
import type { Metadata } from "next";
import { Callout } from "@/components/primitives";
import { verifyEmailAction } from "@/features/auth/actions";

export const metadata: Metadata = { title: "Verify your email" };

/**
 * Email verification.
 *
 * The token is consumed on load. It is single-use and time-limited, and an expired or
 * already-used token produces the same neutral outcome as an unknown one — there is nothing
 * to learn from the difference (`SENS-SEC-011`).
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params["token"];
  const token = typeof raw === "string" ? raw : null;

  const outcome = token === null ? { verified: false } : await verifyEmailAction(token);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="type-title">{outcome.verified ? "Email confirmed" : "Link not valid"}</h1>

      {outcome.verified ? (
        <Callout tone="verified" title="Verified">
          Your email address is confirmed. Your results will be saved to this account.
        </Callout>
      ) : (
        <Callout tone="caution" title="Nothing to confirm">
          That link has expired, has already been used, or is not one of ours. Verification links
          can only be used once and are valid for 24 hours.
        </Callout>
      )}

      <p className="type-body-s text-text-3">
        <Link href="/" className="text-text-1 underline underline-offset-4">
          Back to SensLab
        </Link>
      </p>
    </div>
  );
}

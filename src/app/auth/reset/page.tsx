import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/AuthForm";
import { completePasswordResetAction, requestPasswordResetAction } from "@/features/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

export const metadata: Metadata = { title: "Reset your password" };

/**
 * Two states on one route: request a link, or use one.
 *
 * The request form's response is identical whether or not an account exists
 * (`SENS-SEC-010`), which is why the success copy says "if that email has an account".
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params["token"];
  const token = typeof raw === "string" && raw.length > 0 ? raw : null;

  if (token === null) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h1 className="type-title">Reset your password</h1>
          <p className="type-body-s text-text-2">
            We will send a single-use link. It expires in 30 minutes, and using it signs you out
            everywhere else.
          </p>
        </div>

        <AuthForm
          action={requestPasswordResetAction}
          submitLabel="Send reset link"
          successTitle="Check your email"
          fields={[
            {
              name: "email",
              label: "Email",
              type: "email",
              autoComplete: "email",
              required: true,
            },
          ]}
        />

        <p className="type-body-s text-text-3">
          <Link href="/auth/sign-in" className="text-text-1 underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="type-title">Choose a new password</h1>

      <AuthForm
        action={completePasswordResetAction}
        submitLabel="Set new password"
        successTitle="Password changed"
        hiddenFields={{ token }}
        fields={[
          {
            name: "password",
            label: "New password",
            type: "password",
            autoComplete: "new-password",
            required: true,
            hint: `At least ${MIN_PASSWORD_LENGTH} characters.`,
          },
        ]}
      />

      <p className="type-body-s text-text-3">
        <Link href="/auth/sign-in" className="text-text-1 underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

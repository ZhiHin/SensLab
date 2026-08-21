import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/AuthForm";
import { signUpAction } from "@/features/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="type-title">Keep your results</h1>
        <p className="type-body-s text-text-2">
          You do not need an account to run a calibration. An account keeps your results, lets you
          compare sessions over time, and stores more than one hardware setup.
        </p>
      </div>

      <AuthForm
        action={signUpAction}
        submitLabel="Create account"
        successTitle="Account created"
        fields={[
          {
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
            required: true,
          },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "new-password",
            required: true,
            hint: `At least ${MIN_PASSWORD_LENGTH} characters. No other rules — length is what matters.`,
          },
          {
            name: "displayName",
            label: "Display name (optional)",
            type: "text",
            autoComplete: "nickname",
            required: false,
          },
        ]}
      />

      <p className="type-body-s text-text-3">
        Already have an account?{" "}
        <Link href="/auth/sign-in" className="text-text-1 underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/AuthForm";
import { signInAction } from "@/features/auth/actions";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="type-title">Sign in</h1>

      <AuthForm
        action={signInAction}
        submitLabel="Sign in"
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email", required: true },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "current-password",
            required: true,
          },
        ]}
      />

      <div className="flex flex-col gap-2">
        <p className="type-body-s text-text-3">
          <Link href="/auth/reset" className="text-text-1 underline underline-offset-4">
            Forgot your password?
          </Link>
        </p>
        <p className="type-body-s text-text-3">
          No account yet?{" "}
          <Link href="/auth/sign-up" className="text-text-1 underline underline-offset-4">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

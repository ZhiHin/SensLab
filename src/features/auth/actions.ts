"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clientAddressFrom } from "@/lib/client-address";
import {
  claimGuestSessionForUser,
  completePasswordReset,
  register,
  requestPasswordReset,
  signIn,
  signOut,
  verifyEmail,
} from "@/services/auth-service";
import {
  clearAuthCookie,
  clearGuestCookie,
  getRequestContext,
  readGuestToken,
  setAuthCookie,
} from "@/services/session-context";
import { getEnv } from "@/lib/env";
import { getEmailTransport, passwordResetEmail, verificationEmail } from "@/lib/email";
import { isAppError, toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import {
  completePasswordResetSchema,
  requestPasswordResetSchema,
  signInSchema,
  signUpSchema,
} from "./schema";
import type { FormState } from "./form-state";

/**
 * Authentication server actions.
 *
 * These are the boundary: they validate with the shared Zod schemas, call the service layer,
 * and translate the outcome into a form state. They contain no business logic and no SQL.
 *
 * Every one re-validates on the server. The client-side schema exists to give fast feedback,
 * never to be trusted (`SENS-SEC-006`).
 */

const log = createLogger({ base: { component: "auth-actions" } });

function fieldErrorsFrom(error: z.ZodError): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    errors[key] ??= issue.message;
  }
  return errors;
}

async function requestMetadata(): Promise<{ ip?: string; userAgent?: string }> {
  const headerList = await headers();
  // Not the leftmost entry: that is the one the client writes. See `clientAddressFrom`.
  const ip = clientAddressFrom(headerList.get("x-forwarded-for"), getEnv().TRUSTED_PROXY_HOPS);
  const userAgent = headerList.get("user-agent") ?? undefined;
  return {
    ...(ip === undefined || ip.length === 0 ? {} : { ip }),
    ...(userAgent === undefined ? {} : { userAgent }),
  };
}

function failure(message: string, fieldErrors: Readonly<Record<string, string>> = {}): FormState {
  return { status: "error", message, fieldErrors };
}

/**
 * Claims any guest work this browser had already done.
 *
 * A calibration completed before signing up must survive registration (`SENS-BR-001`). The
 * token comes from the HttpOnly cookie only — never from the form (doc 23 §23.6).
 */
async function claimGuestWorkIfAny(): Promise<void> {
  const context = await getRequestContext();
  if (context.actor.kind !== "user") return;
  const guestToken = await readGuestToken();
  if (guestToken === null) return;
  const claim = await claimGuestSessionForUser(context.actor, guestToken);
  if (claim.claimed) await clearGuestCookie();
}

/* ------------------------------------------------------------------ sign up */

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const displayName = formData.get("displayName");
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName:
      typeof displayName === "string" && displayName.trim().length > 0 ? displayName : undefined,
  });

  if (!parsed.success) {
    return failure("Check the highlighted fields.", fieldErrorsFrom(parsed.error));
  }

  try {
    const env = getEnv();
    const result = await register(parsed.data, await requestMetadata());

    if (result.verificationToken !== null) {
      await getEmailTransport(env.NODE_ENV === "production").deliver(
        verificationEmail(env.APP_URL, result.verificationToken, parsed.data.email),
      );
    }

    if (result.sessionToken !== null) {
      await setAuthCookie(result.sessionToken);
      await claimGuestWorkIfAny();
    }

    return { status: "success", message: result.message, fieldErrors: {} };
  } catch (error: unknown) {
    const appError = toAppError(error);
    if (!isAppError(error)) log.error("sign-up failed", { detail: appError.message });
    return failure(appError.publicMessage);
  }
}

/* ------------------------------------------------------------------ sign in */

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return failure("Check the highlighted fields.", fieldErrorsFrom(parsed.error));
  }

  try {
    const result = await signIn(parsed.data, await requestMetadata());
    if (result.sessionToken === null) return failure(result.message);

    await setAuthCookie(result.sessionToken);
    await claimGuestWorkIfAny();
  } catch (error: unknown) {
    const appError = toAppError(error);
    if (!isAppError(error)) log.error("sign-in failed", { detail: appError.message });
    return failure(appError.publicMessage);
  }

  // `redirect` signals control flow by throwing, so it sits outside the try block.
  redirect("/");
}

/* ------------------------------------------------------------------ sign out */

export async function signOutAction(): Promise<void> {
  const context = await getRequestContext();
  await signOut(context.authSessionId);
  await clearAuthCookie();
  redirect("/");
}

/* ------------------------------------------------------------------ verification */

export async function verifyEmailAction(token: string): Promise<{ readonly verified: boolean }> {
  const parsed = z.string().min(16).max(256).safeParse(token);
  if (!parsed.success) return { verified: false };
  return verifyEmail(parsed.data);
}

/* ------------------------------------------------------------------ password reset */

export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = requestPasswordResetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return failure("Check the highlighted fields.", fieldErrorsFrom(parsed.error));
  }

  try {
    const env = getEnv();
    const result = await requestPasswordReset(parsed.data, await requestMetadata());
    if (result.resetToken !== null) {
      await getEmailTransport(env.NODE_ENV === "production").deliver(
        passwordResetEmail(env.APP_URL, result.resetToken, parsed.data.email),
      );
    }
    // The same message either way: whether an account exists is not disclosed.
    return { status: "success", message: result.message, fieldErrors: {} };
  } catch (error: unknown) {
    return failure(toAppError(error).publicMessage);
  }
}

export async function completePasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = completePasswordResetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return failure("Check the highlighted fields.", fieldErrorsFrom(parsed.error));
  }

  try {
    const result = await completePasswordReset(parsed.data);
    if (!result.reset) {
      return failure("That reset link has expired or has already been used.");
    }
    // Every session was revoked, including this browser's.
    await clearAuthCookie();
    return {
      status: "success",
      message: "Your password has been changed. Sign in with your new password.",
      fieldErrors: {},
    };
  } catch (error: unknown) {
    return failure(toAppError(error).publicMessage);
  }
}

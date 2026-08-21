import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

/**
 * Authentication boundary schemas.
 *
 * One schema per boundary payload, shared by the client form and the server action
 * (`SENS-NFR-029`). The server never trusts the client's validation — it re-runs the same
 * schema — but sharing the definition means the two cannot disagree about what is valid.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .pipe(z.email("enter a valid email address"))
  .transform((value) => value.toLowerCase());

/**
 * Minimum length only.
 *
 * No composition rules: they measurably reduce entropy by pushing users toward
 * "Password1!" patterns, and they annoy everyone (doc 23 §23.3). Length plus a
 * compromised-password check is the better trade.
 */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(256, "passwords longer than 256 characters are not accepted");

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(60).optional(),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

export const completePasswordResetSchema = z.object({
  token: z.string().min(16).max(256),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(16).max(256),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
export type CompletePasswordResetInput = z.infer<typeof completePasswordResetSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

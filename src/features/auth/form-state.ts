/**
 * Form state shared by the auth server actions and their client forms.
 *
 * Kept out of `actions.ts` because a `"use server"` module may only export async functions —
 * a constant or a type exported from one is a build error.
 */
export interface FormState {
  readonly status: "idle" | "error" | "success";
  readonly message: string;
  readonly fieldErrors: Readonly<Record<string, string>>;
}

export const idleFormState: FormState = { status: "idle", message: "", fieldErrors: {} };

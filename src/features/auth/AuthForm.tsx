"use client";

import { useActionState } from "react";
import { Button, Callout, Field } from "@/components/primitives";
import { idleFormState, type FormState } from "./form-state";

/**
 * A form driven by a server action.
 *
 * Progressive enhancement is deliberate: the form posts and works without JavaScript, and
 * `useActionState` only adds pending state and inline errors on top. That matters because the
 * auth screens are the one place a user cannot route around if the client bundle fails.
 */

export interface AuthFieldSpec {
  readonly name: string;
  readonly label: string;
  readonly type: "email" | "password" | "text";
  readonly autoComplete: string;
  readonly required: boolean;
  readonly hint?: string;
}

export function AuthForm({
  action,
  fields,
  submitLabel,
  hiddenFields = {},
  successTitle = "Done",
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  fields: readonly AuthFieldSpec[];
  submitLabel: string;
  hiddenFields?: Readonly<Record<string, string>>;
  successTitle?: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleFormState);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {state.status === "error" && state.message.length > 0 && (
        <div role="alert">
          <Callout tone="caution" title="Not submitted">
            {state.message}
          </Callout>
        </div>
      )}

      {state.status === "success" && state.message.length > 0 && (
        <div role="status">
          <Callout tone="verified" title={successTitle}>
            {state.message}
          </Callout>
        </div>
      )}

      {fields.map((field) => {
        const props = {
          id: field.name,
          name: field.name,
          type: field.type,
          label: field.label,
          autoComplete: field.autoComplete,
          required: field.required,
        };
        const error = state.fieldErrors[field.name];
        return (
          <Field
            key={field.name}
            {...props}
            {...(field.hint === undefined ? {} : { hint: field.hint })}
            {...(error === undefined ? {} : { error })}
          />
        );
      })}

      <Button type="submit" disabled={pending}>
        {pending ? "Working…" : submitLabel}
      </Button>
    </form>
  );
}

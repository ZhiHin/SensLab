import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * Design-system primitives (doc 26 §26.7).
 *
 * Deliberately small: Phase 1 needs enough vocabulary to build the shell and the auth screens
 * honestly, not a component library. Every one of them uses the tokens rather than literal
 * colours, so the palette stays changeable in one place.
 */

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ label */

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("type-label", className)}>{children}</span>;
}

/* ------------------------------------------------------------------ readout */

/**
 * The most repeated composition in the product: a micro-label above a monospaced value,
 * with its unit in tertiary text.
 */
export function Readout({
  label,
  value,
  unit,
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <Label>{label}</Label>
      <span className="type-data-l text-text-1">
        {value}
        {unit !== undefined && <span className="ml-2 type-data-s text-text-3">{unit}</span>}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ panel */

export function Panel({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <section
      className={cx(
        "reticle-corners border border-hairline bg-surface p-6",
        "rounded-[var(--radius-xs)]",
        className,
      )}
    >
      {title !== undefined && (
        <header className="mb-4 border-b border-hairline pb-3">
          <Label>{title}</Label>
        </header>
      )}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ buttons */

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  readonly variant?: "primary" | "secondary" | "ghost";
};

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  const base =
    "type-label inline-flex items-center justify-center gap-2 px-5 py-3 " +
    "rounded-[var(--radius-xs)] transition-colors duration-[var(--duration-micro)] " +
    "disabled:cursor-not-allowed disabled:opacity-50";

  const variants = {
    // No scale transform on a primary action: a moving click target is a usability defect.
    primary: "bg-accent text-void hover:bg-[color-mix(in_srgb,var(--color-accent)_88%,white)]",
    secondary:
      "border border-hairline-strong text-text-1 hover:border-accent-dim hover:text-text-1",
    ghost: "text-text-2 underline-offset-4 hover:text-text-1 hover:underline",
  } as const;

  return <button className={cx(base, variants[variant], className)} {...props} />;
}

/* ------------------------------------------------------------------ field */

type FieldProps = ComponentPropsWithoutRef<"input"> & {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly id: string;
};

/**
 * A labelled input.
 *
 * The label is always visible and always programmatically associated — never a placeholder
 * standing in for one (`SENS-UX-030`). Errors are linked by `aria-describedby` so a screen
 * reader announces them with the field.
 */
export function Field({ label, hint, error, id, className, ...props }: FieldProps) {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="type-label">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error === undefined ? undefined : true}
        className={cx(
          "w-full bg-surface-2 px-3 py-3 text-text-1",
          "border-b border-hairline focus:border-accent focus:outline-none",
          "rounded-t-[var(--radius-xs)] transition-colors duration-[var(--duration-micro)]",
          error !== undefined && "border-critical",
          className,
        )}
        {...props}
      />
      {hint !== undefined && (
        <p id={hintId} className="type-body-s text-text-3">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="type-body-s text-critical">
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ status pill */

export type StatusTone = "verified" | "unverified" | "caution" | "neutral";

const TONE_STYLES: Readonly<Record<StatusTone, string>> = {
  verified: "border-accent text-accent",
  unverified: "border-caution text-caution",
  caution: "border-caution text-caution",
  neutral: "border-hairline-strong text-text-3",
};

/**
 * A status indicator.
 *
 * Carries a glyph *and* a word, never colour alone (`SENS-UX-005`, `SENS-UX-029`).
 */
export function StatusPill({
  tone,
  status,
  children,
}: {
  tone: StatusTone;
  /** The state being reported, when it is narrower than the tone. Defaults to the tone. */
  status?: string;
  children: ReactNode;
}) {
  const glyph = tone === "verified" ? "✓" : tone === "neutral" ? "·" : "!";
  return (
    <span
      data-status={status ?? tone}
      className={cx(
        "type-label inline-flex items-center gap-1.5 border px-2 py-1",
        "rounded-[var(--radius-xs)] bg-transparent",
        TONE_STYLES[tone],
      )}
    >
      <span aria-hidden="true">{glyph}</span>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ callout */

export function Callout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: StatusTone;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "border-l-2 bg-surface-2 px-4 py-3",
        tone === "verified"
          ? "border-accent"
          : tone === "neutral"
            ? "border-hairline-strong"
            : "border-caution",
      )}
    >
      <p className="type-label mb-1">{title}</p>
      <div className="type-body-s text-text-2">{children}</div>
    </div>
  );
}

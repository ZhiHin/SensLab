"use client";

/**
 * The last-resort boundary: a failure in the root layout itself (doc 22 §22.6).
 *
 * This replaces the whole document, so it must render its own `<html>` and `<body>` and cannot
 * rely on anything the root layout provides — not the font variables, not the theme tokens,
 * not `globals.css`. Everything here is therefore inline and self-sufficient. It is the one
 * screen in the product that cannot be styled by the design system, because reaching it means
 * the design system did not load.
 *
 * As in the route boundary, the message is never rendered (`SENS-SEC-016`); the digest is.
 */

export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#08090a",
          color: "#e8eaed",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "2rem",
        }}
      >
        <main style={{ maxWidth: "44rem" }}>
          <p
            style={{
              margin: 0,
              fontSize: "0.75rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#9aa0a6",
            }}
          >
            Error
          </p>
          <h1 style={{ margin: "0.75rem 0 0", fontSize: "2rem", lineHeight: 1.15 }}>
            SensLab failed to start.
          </h1>
          <p style={{ margin: "1.5rem 0 0", color: "#c3c7cb", lineHeight: 1.6 }}>
            Something went wrong before the page could load. Reloading usually clears it. Your
            stored sessions and results are unaffected.
          </p>
          {error.digest === undefined ? null : (
            <p
              style={{
                margin: "1rem 0 0",
                color: "#9aa0a6",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              Reference {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "2rem",
              padding: "0.75rem 1.5rem",
              border: "1px solid #2a2d31",
              background: "transparent",
              color: "#e8eaed",
              font: "inherit",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              fontSize: "0.75rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

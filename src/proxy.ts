import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge proxy: CSP and CSRF origin verification.
 *
 * ## Content-Security-Policy (`SENS-SEC-013`)
 *
 * A per-request nonce is generated and passed to Next through the `x-nonce` header, which
 * Next applies to the scripts it emits. There is no `unsafe-inline` for scripts in any
 * environment; `unsafe-eval` is present only in development, where the dev server needs it.
 *
 * ## Origin verification (doc 23 §23.5)
 *
 * Every mutating request must come from our own origin. `SameSite=Lax` cookies already block
 * cross-site POSTs, and Server Actions carry their own origin checking — but the exact
 * guarantees of the framework version are an open verification item (EV-013), so this check
 * exists so that the protection does not depend solely on framework behaviour. Defence in
 * depth here is cheap; discovering the assumption was wrong would not be.
 */

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function buildCsp(nonce: string, isDevelopment: boolean): string {
  const scriptSrc = isDevelopment
    ? `'self' 'nonce-${nonce}' 'unsafe-eval' 'strict-dynamic'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    // Tailwind emits a stylesheet; `unsafe-inline` for styles is required by Next's inline
    // style attributes and is a materially smaller risk than for scripts.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    // Fonts are self-hosted by next/font — no third-party font host is permitted.
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}

function originIsTrusted(request: NextRequest): boolean {
  // Same-origin and same-site navigations are fine; cross-site mutations are not.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) {
    return fetchSite === "same-origin" || fetchSite === "none";
  }

  // Older clients without Fetch Metadata: fall back to comparing Origin against Host.
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  const host = request.headers.get("host");
  if (host === null) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest): NextResponse {
  const isDevelopment = process.env.NODE_ENV !== "production";

  if (MUTATING_METHODS.has(request.method) && !originIsTrusted(request)) {
    return new NextResponse(
      JSON.stringify({ code: "VALIDATION_FAILED", message: "Request origin was not accepted." }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, isDevelopment);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation, which need no policy and would
    // pay the cost of a nonce for nothing.
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};

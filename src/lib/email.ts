import "server-only";
import { getEnv } from "./env";
import { createLogger } from "./logger";

/**
 * Email transport.
 *
 * Two transports: `console`, which writes to stdout in development, and an HTTP transport
 * driven by a provider descriptor (Resend or Postmark). Selection is configuration, not code.
 *
 * ## No SDK
 *
 * Both providers are a single JSON `POST` over HTTPS, so `fetch` is the whole integration. An
 * SDK would add a dependency, a release cadence and a supply-chain surface to save about
 * fifteen lines, against a codebase that ships nine runtime dependencies in total.
 *
 * ## The body is a secret
 *
 * Every message this module sends carries a **live single-use token** — a verification link or
 * a password reset. It follows that no failure path may log the message, and none does: errors
 * carry the provider, the status and the provider's own error id, never `text` and never the
 * recipient (`SENS-SEC-024`).
 *
 * ## Honest failure
 *
 * `deliver()` reports whether the message actually left the building, and a deployment with no
 * provider configured says so in its logs on every send rather than failing silently.
 */

const log = createLogger({ base: { component: "email" } });

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface DeliveryResult {
  readonly delivered: boolean;
  readonly transport: string;
}

export interface EmailTransport {
  readonly name: string;
  deliver(message: EmailMessage): Promise<DeliveryResult>;
}

/**
 * Writes the message to stdout.
 *
 * The body — which contains a single-use token — is printed only outside production. In
 * production this transport records that a message *would* have been sent and warns that no
 * provider is configured, without putting a live token in a log (`SENS-SEC-024`).
 */
export function createConsoleTransport(isProduction: boolean): EmailTransport {
  return {
    name: "console",
    async deliver(message: EmailMessage): Promise<DeliveryResult> {
      if (isProduction) {
        log.error("no email provider is configured; message not delivered", {
          subject: message.subject,
        });
        return { delivered: false, transport: "console" };
      }

      process.stdout.write(
        `\n--- email (development transport) ---\n` +
          `to:      ${message.to}\n` +
          `subject: ${message.subject}\n\n${message.text}\n` +
          `-------------------------------------\n\n`,
      );
      return { delivered: true, transport: "console" };
    },
  };
}

/* ------------------------------------------------------------------ HTTP transports */

/**
 * What differs between providers. Everything else — timeouts, retries, error classification,
 * what may be logged — is shared, because that is where the behaviour that matters lives.
 */
interface ProviderDescriptor {
  readonly name: "resend" | "postmark";
  readonly endpoint: string;
  headers(apiKey: string): Record<string, string>;
  body(message: EmailMessage, from: string): unknown;
  /** The provider's own error identifier, for correlating with their dashboard. */
  errorId(payload: unknown): string | undefined;
}

const PROVIDERS: Readonly<Record<"resend" | "postmark", ProviderDescriptor>> = {
  resend: {
    name: "resend",
    endpoint: "https://api.resend.com/emails",
    headers: (apiKey) => ({
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    }),
    body: (message, from) => ({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
    errorId: (payload) => asRecord(payload)?.["name"] as string | undefined,
  },
  postmark: {
    name: "postmark",
    endpoint: "https://api.postmarkapp.com/email",
    headers: (apiKey) => ({
      "x-postmark-server-token": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    }),
    body: (message, from) => ({
      From: from,
      To: message.to,
      Subject: message.subject,
      TextBody: message.text,
      // Transactional mail must not travel on a broadcast stream: it changes deliverability
      // handling and, on Postmark, whether unsubscribe rules apply to a password reset.
      MessageStream: "outbound",
    }),
    errorId: (payload) => {
      const code = asRecord(payload)?.["ErrorCode"];
      return typeof code === "number" ? String(code) : undefined;
    },
  },
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * A 4xx other than 429 means the request itself was wrong — a bad key, an unverified sender,
 * a malformed address. Retrying that is a slower way to fail, so only transient classes are
 * retried.
 */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface HttpTransportOptions {
  readonly apiKey: string;
  readonly from: string;
  /** Per-attempt budget. This runs inside a user-facing request, so it is deliberately short. */
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  /** Injected so tests do not sleep, and so the transport can be exercised without a network. */
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * A provider transport over `fetch`.
 *
 * ## Why the retry budget is this small
 *
 * `deliver()` is awaited inside a server action, so every millisecond spent here is a
 * millisecond the person who just pressed "Sign up" spends watching a spinner. Two attempts
 * with a short backoff covers the case worth covering — a single blip or a rate-limit burst —
 * and nothing more. Surviving a provider outage needs a queue and a worker, which is a
 * different piece of infrastructure and is deliberately not pretended at here.
 */
export function createHttpTransport(
  provider: "resend" | "postmark",
  options: HttpTransportOptions,
): EmailTransport {
  const descriptor = PROVIDERS[provider];
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return {
    name: descriptor.name,
    async deliver(message: EmailMessage): Promise<DeliveryResult> {
      const failed: DeliveryResult = { delivered: false, transport: descriptor.name };

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const response = await doFetch(descriptor.endpoint, {
            method: "POST",
            headers: descriptor.headers(options.apiKey),
            body: JSON.stringify(descriptor.body(message, options.from)),
            signal: AbortSignal.timeout(timeoutMs),
          });

          if (response.ok) return { delivered: true, transport: descriptor.name };

          // Read the body only to extract the provider's error id. It is never logged whole:
          // a provider echoing the request back would put the token in the log.
          const payload: unknown = await response.json().catch(() => undefined);
          const detail = {
            provider: descriptor.name,
            status: response.status,
            attempt,
            ...(descriptor.errorId(payload) === undefined
              ? {}
              : { providerError: descriptor.errorId(payload) }),
          };

          if (!isRetryable(response.status) || attempt === maxAttempts) {
            log.error("email delivery failed", detail);
            return failed;
          }
          log.warn("email delivery failed, retrying", detail);
        } catch (error: unknown) {
          // A timeout or a DNS/socket failure. The message is safe to log; it describes the
          // transport, not the mail.
          const detail = {
            provider: descriptor.name,
            attempt,
            reason: error instanceof Error ? error.name : "unknown",
          };
          if (attempt === maxAttempts) {
            log.error("email delivery failed", detail);
            return failed;
          }
          log.warn("email delivery failed, retrying", detail);
        }

        // Linear, short, and jitter-free: with two attempts there is no thundering herd to
        // spread out, and a predictable delay is easier to reason about in a request budget.
        await sleep(250 * attempt);
      }

      return failed;
    },
  };
}

let transport: EmailTransport | null = null;

/**
 * The configured transport, built once.
 *
 * `env.ts` has already refused to start if a provider was selected without a key or a sender,
 * so by the time this runs the configuration is known good and the non-null assertions below
 * are guarded by that check rather than by hope.
 */
export function getEmailTransport(isProduction: boolean): EmailTransport {
  if (transport !== null) return transport;

  const env = getEnv();
  transport =
    env.EMAIL_TRANSPORT === "console"
      ? createConsoleTransport(isProduction)
      : createHttpTransport(env.EMAIL_TRANSPORT, {
          apiKey: env.EMAIL_API_KEY as string,
          from: env.EMAIL_FROM as string,
        });
  return transport;
}

/** Test support: replaces the transport so a test can assert what would have been sent. */
export function setEmailTransport(replacement: EmailTransport | null): void {
  transport = replacement;
}

export function verificationEmail(appUrl: string, token: string, to: string): EmailMessage {
  return {
    to,
    subject: "Confirm your SensLab account",
    text:
      `Confirm your email address to finish setting up your SensLab account:\n\n` +
      `${appUrl}/auth/verify?token=${encodeURIComponent(token)}\n\n` +
      `This link can be used once and expires in 24 hours.\n` +
      `If you did not create a SensLab account, you can ignore this message.`,
  };
}

export function passwordResetEmail(appUrl: string, token: string, to: string): EmailMessage {
  return {
    to,
    subject: "Reset your SensLab password",
    text:
      `Use this link to choose a new password:\n\n` +
      `${appUrl}/auth/reset?token=${encodeURIComponent(token)}\n\n` +
      `This link can be used once and expires in 30 minutes. Using it signs you out ` +
      `everywhere else.\nIf you did not request this, you can ignore this message — your ` +
      `password has not changed.`,
  };
}

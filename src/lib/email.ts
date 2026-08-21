import "server-only";
import { createLogger } from "./logger";

/**
 * Email transport.
 *
 * Phase 1 ships the **interface** and a development transport that prints the message to
 * stdout. There is deliberately no provider integration yet: choosing and wiring one
 * (Resend / Postmark / SES) belongs with the full account flows in Phase 9, and adding a
 * dependency now would be speculative.
 *
 * What this is *not* is a stub pretending to deliver mail. `deliver()` reports honestly
 * whether the message left the building, and a deployment that has not configured a real
 * transport says so in its logs on every send rather than failing silently.
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

let transport: EmailTransport | null = null;

export function getEmailTransport(isProduction: boolean): EmailTransport {
  transport ??= createConsoleTransport(isProduction);
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

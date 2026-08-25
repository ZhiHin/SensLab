import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHttpTransport,
  passwordResetEmail,
  verificationEmail,
  type EmailMessage,
} from "@/lib/email";

/**
 * The provider transports (`SENS-SEC-024`).
 *
 * Two things are being protected here, and only one of them is "does it send mail".
 *
 * The first is **the token**. Every message carries a live single-use credential — a
 * verification link or a password reset — so no failure path may put the body anywhere it
 * could be read later. The provider sees it because the provider must; a log must not.
 *
 * The second is **the request budget**. `deliver()` is awaited inside a server action, so a
 * transport that retries generously is a transport that makes someone watch a spinner. The
 * retry policy is asserted rather than assumed.
 */

const MESSAGE: EmailMessage = {
  to: "player@example.test",
  subject: "Confirm your SensLab account",
  text: "https://senslab.test/auth/verify?token=SUPER-SECRET-TOKEN",
};

/** A `fetch` that records what it was called with and replays scripted responses. */
function stubFetch(responses: readonly (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    return next as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const ok = (): Response => new Response(JSON.stringify({ id: "abc" }), { status: 200 });
const failure = (status: number, body: unknown = {}): Response =>
  new Response(JSON.stringify(body), { status });

const noSleep = async (): Promise<void> => undefined;

describe("delivering through a provider", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("posts to Resend with the key as a bearer token", async () => {
    const { impl, calls } = stubFetch([ok()]);
    const transport = createHttpTransport("resend", {
      apiKey: "re_test_key",
      from: "SensLab <no-reply@senslab.test>",
      fetchImpl: impl,
      sleep: noSleep,
    });

    const result = await transport.deliver(MESSAGE);

    expect(result).toEqual({ delivered: true, transport: "resend" });
    const call = calls[0];
    expect(call?.url).toBe("https://api.resend.com/emails");
    expect(call?.init.method).toBe("POST");
    expect((call?.init.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer re_test_key",
    );
    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
    expect(body["to"]).toEqual([MESSAGE.to]);
    expect(body["from"]).toBe("SensLab <no-reply@senslab.test>");
    expect(body["text"]).toBe(MESSAGE.text);
  });

  it("posts to Postmark with its own header and on the transactional stream", async () => {
    const { impl, calls } = stubFetch([ok()]);
    const transport = createHttpTransport("postmark", {
      apiKey: "pm_test_key",
      from: "no-reply@senslab.test",
      fetchImpl: impl,
      sleep: noSleep,
    });

    expect(await transport.deliver(MESSAGE)).toEqual({ delivered: true, transport: "postmark" });
    const call = calls[0];
    expect((call?.init.headers as Record<string, string>)["x-postmark-server-token"]).toBe(
      "pm_test_key",
    );
    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
    // A password reset must not travel on a broadcast stream, where unsubscribe handling
    // applies and deliverability is treated differently.
    expect(body["MessageStream"]).toBe("outbound");
    expect(body["TextBody"]).toBe(MESSAGE.text);
  });
});

describe("what it retries, and what it does not", () => {
  it("retries a 500 and succeeds on the second attempt", async () => {
    const { impl, calls } = stubFetch([failure(500), ok()]);
    const transport = createHttpTransport("resend", {
      apiKey: "k",
      from: "a@b.test",
      fetchImpl: impl,
      sleep: noSleep,
    });

    expect(await transport.deliver(MESSAGE)).toEqual({ delivered: true, transport: "resend" });
    expect(calls).toHaveLength(2);
  });

  it("retries a 429, because a rate-limit burst is transient", async () => {
    const { impl, calls } = stubFetch([failure(429), ok()]);
    const transport = createHttpTransport("resend", {
      apiKey: "k",
      from: "a@b.test",
      fetchImpl: impl,
      sleep: noSleep,
    });

    expect((await transport.deliver(MESSAGE)).delivered).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("does not retry a 422, because the request itself is wrong", async () => {
    // An unverified sender or a malformed address fails identically every time. Retrying is
    // just a slower way to fail while someone waits.
    const { impl, calls } = stubFetch([failure(422, { name: "validation_error" })]);
    const transport = createHttpTransport("resend", {
      apiKey: "k",
      from: "a@b.test",
      fetchImpl: impl,
      sleep: noSleep,
    });

    expect(await transport.deliver(MESSAGE)).toEqual({ delivered: false, transport: "resend" });
    expect(calls).toHaveLength(1);
  });

  it("does not retry a 401, because a bad key will not fix itself", async () => {
    const { impl, calls } = stubFetch([failure(401)]);
    const transport = createHttpTransport("postmark", {
      apiKey: "wrong",
      from: "a@b.test",
      fetchImpl: impl,
      sleep: noSleep,
    });

    expect((await transport.deliver(MESSAGE)).delivered).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("gives up after the attempt budget and reports honestly", async () => {
    const { impl, calls } = stubFetch([failure(503), failure(503), failure(503)]);
    const transport = createHttpTransport("resend", {
      apiKey: "k",
      from: "a@b.test",
      fetchImpl: impl,
      sleep: noSleep,
    });

    expect(await transport.deliver(MESSAGE)).toEqual({ delivered: false, transport: "resend" });
    expect(calls).toHaveLength(2);
  });

  it("treats a network error like a transient failure, then stops", async () => {
    const { impl, calls } = stubFetch([new Error("socket hang up"), ok()]);
    const transport = createHttpTransport("resend", {
      apiKey: "k",
      from: "a@b.test",
      fetchImpl: impl,
      sleep: noSleep,
    });

    expect((await transport.deliver(MESSAGE)).delivered).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("never reports delivery it did not achieve", async () => {
    // The property the account flows depend on: `delivered` is evidence, not optimism.
    for (const status of [400, 401, 403, 404, 422, 429, 500, 503]) {
      const { impl } = stubFetch([failure(status)]);
      const transport = createHttpTransport("resend", {
        apiKey: "k",
        from: "a@b.test",
        fetchImpl: impl,
        sleep: noSleep,
      });
      expect(await transport.deliver(MESSAGE), `status ${status}`).toEqual({
        delivered: false,
        transport: "resend",
      });
    }
  });
});

describe("the token never leaves through a log", () => {
  it("logs no part of the message when delivery fails", async () => {
    // The failure path is the one that writes to a log, so it is the one that could leak a
    // live reset link. Everything the log is allowed to say describes the *transport*.
    const written: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        written.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      }),
    );
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown): boolean => {
        written.push(String(chunk));
        return true;
      });

    try {
      const { impl } = stubFetch([failure(500), failure(500)]);
      const transport = createHttpTransport("resend", {
        apiKey: "re_super_secret_key",
        from: "a@b.test",
        fetchImpl: impl,
        sleep: noSleep,
      });
      await transport.deliver(MESSAGE);
    } finally {
      for (const spy of spies) spy.mockRestore();
      stdout.mockRestore();
    }

    const all = written.join("\n");
    expect(all).not.toContain("SUPER-SECRET-TOKEN");
    expect(all).not.toContain(MESSAGE.text);
    expect(all).not.toContain(MESSAGE.to);
    // Nor the credential used to authenticate the request.
    expect(all).not.toContain("re_super_secret_key");
  });
});

describe("the messages themselves", () => {
  it("carries a usable single-use link and says what it does", () => {
    const verify = verificationEmail("https://senslab.test", "tok-123", "a@b.test");
    expect(verify.text).toContain("https://senslab.test/auth/verify?token=tok-123");
    expect(verify.text).toMatch(/once/i);

    const reset = passwordResetEmail("https://senslab.test", "tok+456", "a@b.test");
    // Encoded, or a token containing a URL-significant character would arrive truncated.
    expect(reset.text).toContain("token=tok%2B456");
    // Says the password has not changed: the message reaches people who did not ask for it.
    expect(reset.text).toMatch(/has not changed/i);
  });
});

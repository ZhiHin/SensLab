import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/db/client";
import { userRepo } from "@/repositories";
import { hashPassword } from "@/lib/password";
import { asUser, resetVolatileTables } from "@tests/helpers/db";

/**
 * Display preferences (FR-103, doc 28 §28.10).
 *
 * The service reads cookies and request headers, which only exist inside a request. They are
 * stubbed here so the *storage* half — does a signed-in user's choice survive, and does it
 * follow them rather than the browser — can be tested against the real database.
 */

const store = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = store.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string) => {
        store.set(name, value);
      },
    }),
  headers: () => Promise.resolve(new Headers({ "accept-language": "en-GB,en;q=0.9" })),
}));

const { getPreferences, setPreferences, localeFromAcceptLanguage, DEFAULT_PREFERENCES } =
  await import("@/services/preferences-service");

async function makeUser(email: string): Promise<string> {
  const { userId } = await userRepo.createUser({
    email,
    passwordHash: await hashPassword("correct-horse-battery-staple"),
  });
  return userId;
}

describe("display preferences", () => {
  beforeEach(async () => {
    store.clear();
    await resetVolatileTables();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("defaults to metric, system motion and the header's language", async () => {
    const preferences = await getPreferences({ kind: "anonymous" });
    expect(preferences.unit).toBe("metric");
    expect(preferences.motion).toBe("system");
    expect(preferences.locale).toBe("en");
    expect(DEFAULT_PREFERENCES.unit).toBe("metric");
  });

  it("stores a signed-in user's choice on the account, so it follows them", async () => {
    const actor = asUser(await makeUser("prefs@senslab.test"));

    await setPreferences(actor, { unit: "imperial", locale: "zh-Hans", motion: "reduced" });

    // Read back through the service...
    const reread = await getPreferences(actor);
    expect(reread).toEqual({ unit: "imperial", locale: "zh-Hans", motion: "reduced" });

    // ...and from the account row itself, which is what makes it follow the user to another
    // browser rather than living in this one's cookie.
    const account = await userRepo.findAccount(actor);
    expect(account?.unitPreference).toBe("imperial");
    expect(account?.locale).toBe("zh-Hans");
    expect(account?.motionPreference).toBe("reduced");
  });

  it("changes one preference without disturbing the others", async () => {
    const actor = asUser(await makeUser("prefs-partial@senslab.test"));
    await setPreferences(actor, { unit: "imperial", locale: "zh-Hans", motion: "reduced" });

    await setPreferences(actor, { unit: "metric" });

    expect(await getPreferences(actor)).toEqual({
      unit: "metric",
      locale: "zh-Hans",
      motion: "reduced",
    });
  });

  it("lets a guest set a preference without an account", async () => {
    const anonymous = { kind: "anonymous" } as const;
    await setPreferences(anonymous, { unit: "imperial" });
    expect((await getPreferences(anonymous)).unit).toBe("imperial");
  });

  it("prefers the account over a stale cookie on a shared machine", async () => {
    const actor = asUser(await makeUser("prefs-shared@senslab.test"));
    // Someone else's preference is sitting in this browser.
    await setPreferences({ kind: "anonymous" }, { unit: "imperial" });

    // The account says nothing yet, so it holds the default — and the account wins.
    expect((await getPreferences(actor)).unit).toBe("metric");
  });

  it("refuses a value outside the supported set", async () => {
    const actor = asUser(await makeUser("prefs-invalid@senslab.test"));
    await expect(setPreferences(actor, { locale: "fr" as never })).rejects.toThrow();
    await expect(setPreferences(actor, { unit: "furlongs" as never })).rejects.toThrow();
  });
});

describe("locale negotiation — doc 28 §28.10", () => {
  it("maps the Simplified Chinese tags and leaves Traditional alone", () => {
    expect(localeFromAcceptLanguage("zh-CN,zh;q=0.9")).toBe("zh-Hans");
    expect(localeFromAcceptLanguage("zh-Hans-CN")).toBe("zh-Hans");
    expect(localeFromAcceptLanguage("zh")).toBe("zh-Hans");
    // Traditional is a different script; serving Simplified would be worse than English.
    expect(localeFromAcceptLanguage("zh-Hant-TW,zh-TW;q=0.9")).toBeNull();
    expect(localeFromAcceptLanguage("en-GB,en;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("de,fr;q=0.7")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it("honours the quality order rather than the written order", () => {
    expect(localeFromAcceptLanguage("en;q=0.3,zh-CN;q=0.9")).toBe("zh-Hans");
  });
});

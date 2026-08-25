import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENV_KEYS } from "@/lib/env";

/**
 * `.env.example` against the schema.
 *
 * The template is what `README.md` tells a new clone to copy, and it is the only place a
 * variable is *discoverable* — `env.ts` will refuse to start without one, but only after
 * someone has already tried. A variable that reaches the schema and not the template is found
 * by failing.
 *
 * This exists because the template spent the whole project ignored by `.gitignore`'s `.env*`
 * rule, so nothing in it had ever been committed and the documented setup step could not work
 * on a fresh checkout. The rule now carries a `!.env.example` exception; this keeps the file
 * honest once it is there.
 */

const TEMPLATE = readFileSync(".env.example", "utf8");

describe("the environment template", () => {
  it("mentions every variable the application reads", () => {
    // Commented-out is fine — an optional variable should be present and inert, not absent.
    const missing = ENV_KEYS.filter((key) => !new RegExp(`^\\s*#?\\s*${key}=`, "m").test(TEMPLATE));
    expect(
      missing,
      "these are read by env.ts but absent from .env.example, so nobody can discover them",
    ).toEqual([]);
  });

  it("carries placeholders rather than usable secrets", () => {
    // The schema rejects anything starting with `replace-me`, which is what makes shipping the
    // template safe: a copied-but-unedited file cannot boot.
    for (const key of ["AUTH_SECRET", "ABUSE_HASH_SALT"]) {
      const line = TEMPLATE.split("\n").find((row) => row.startsWith(`${key}=`));
      expect(line, `${key} is missing from the template`).toBeDefined();
      expect(line ?? "").toContain("replace-me");
    }
  });

  it("leaves the provider API key empty", () => {
    // A real key here would be committed. It is present but unset, so its existence is
    // discoverable without its value being shared.
    const active = TEMPLATE.split("\n").filter((row) => /^\s*EMAIL_API_KEY=.+/.test(row));
    expect(active, "EMAIL_API_KEY has a value in the committed template").toEqual([]);
  });
});

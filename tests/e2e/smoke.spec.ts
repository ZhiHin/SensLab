import { expect, test } from "@playwright/test";

/**
 * Phase 1 smoke coverage.
 *
 * These assert that the foundation is genuinely wired together end to end — the shell reads
 * the database, the auth screens submit through server actions, the security headers are
 * served, and the integrity endpoint reports the truth. They do not test calibration, which
 * does not exist yet.
 */

test.describe("application shell", () => {
  test("renders the roster from the database with honest verification states", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("TRUE SENS");

    // All five launch games, every one unverified — which is what doc 36 records.
    await expect(page.locator('[data-status="unverified"]')).toHaveCount(5);
    await expect(page.locator('[data-status="verified"]')).toHaveCount(0);
    await expect(page.getByText("Counter-Strike 2")).toBeVisible();

    // The two Delta Force builds are distinct games with distinct names (`SENS-BR-015`).
    // Matching exactly is the point: a loose match would pass even if one had swallowed
    // the other.
    await expect(page.getByText("三角洲行动", { exact: true })).toBeVisible();
    await expect(page.getByText("三角洲行动（国际服）", { exact: true })).toBeVisible();

    // The caveat is present on a result-adjacent surface (SENS-BR-022).
    await expect(page.getByText(/is not the game engine/i)).toBeVisible();
  });

  test("shows the active algorithm versions", async ({ page }) => {
    // Phase 6 moved scoring to v2; the shell shows whatever is current, never a literal.
    await page.goto("/");
    await expect(page.getByText("scoring_model_v2")).toBeVisible();
    await expect(page.getByText("calibration_model_v1")).toBeVisible();
    await expect(page.getByText("confidence_model_v1")).toBeVisible();
  });

  test("serves the security headers", async ({ page }) => {
    const response = await page.goto("/");
    const headers = response?.headers() ?? {};

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["permissions-policy"]).toContain("camera=()");

    const csp = headers["content-security-policy"] ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    // A nonce is present and there is no blanket inline-script allowance.
    expect(csp).toMatch(/script-src [^;]*'nonce-/);
    expect(csp).not.toMatch(/script-src [^;]*'unsafe-inline'/);
  });

  test("does not advertise the framework", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.headers()["x-powered-by"]).toBeUndefined();
  });
});

test.describe("health and integrity", () => {
  test("reports ok when parameters and adapters agree with the database", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

test.describe("authentication screens", () => {
  test("sign-up is reachable, labelled and keyboard operable", async ({ page }) => {
    await page.goto("/auth/sign-up");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Keep your results");

    // Visible, associated labels — not placeholders standing in for them (SENS-UX-030).
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();

    await page.getByLabel("Email").focus();
    await expect(page.getByLabel("Email")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  });

  test("rejects an invalid email server-side and says which field", async ({ page }) => {
    await page.goto("/auth/sign-up");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("a-long-enough-password");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText(/valid email address/i)).toBeVisible();
  });

  test("rejects a short password with the length rule, and no composition rule", async ({
    page,
  }) => {
    await page.goto("/auth/sign-up");
    await page.getByLabel("Email").fill("valid@example.test");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByRole("button", { name: /create account/i }).click();

    // Scoped to the field's error element: the hint text says the same thing, and matching
    // both would make this assertion pass even if the server had accepted the password.
    await expect(page.locator("#password-error")).toHaveText(/at least 10 characters/i);
  });

  test("gives the same neutral answer whether or not an account exists — SENS-SEC-010", async ({
    page,
  }) => {
    await page.goto("/auth/reset");
    await page.getByLabel("Email").fill("definitely-not-registered@example.test");
    await page.getByRole("button", { name: /send reset link/i }).click();

    await expect(page.getByRole("status")).toContainText(/if that email has an account/i);
  });

  test("treats an unknown verification token as a neutral non-event", async ({ page }) => {
    await page.goto(`/auth/verify?token=${"z".repeat(40)}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Link not valid");
    await expect(page.getByText(/expired, has already been used/i)).toBeVisible();
  });

  test("offers a skip link as the first focusable element", async ({ page }) => {
    await page.goto("/auth/sign-in");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: /skip to content/i })).toBeFocused();
  });
});

test.describe("cross-site protection", () => {
  test("rejects a cross-origin mutating request", async ({ request }) => {
    const response = await request.post("/api/health", {
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(403);
  });
});

test.describe("the engineering harness never ships", () => {
  test("returns 404 for the lab route in the production build", async ({ page }) => {
    // The guard is a server-side notFound(), not a hidden link: a shipped harness would let
    // anyone run a session against a synthetic definition on an unreviewed surface.
    const response = await page.goto("/lab/engine");
    expect(response?.status()).toBe(404);
  });
});

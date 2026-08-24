import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { AUTH_STATE } from "./auth-state";

/**
 * Phase 9 end-to-end: history, comparison, hardware profiles and the account screens.
 *
 * What a browser proves here that the service tests cannot: the screens are reachable, they
 * render real sessions, a comparison across different hardware carries its flag, and every
 * one of them is a redirect or a 404 for a signed-out visitor rather than a page that merely
 * hides its contents.
 */

interface Fixtures {
  readonly email: string;
  readonly recommendations: Record<string, string>;
  readonly hardwareProfileId: string;
}

const fixtures = JSON.parse(readFileSync("test-results/e2e-fixtures.json", "utf8")) as Fixtures;

test.use({ storageState: AUTH_STATE });

test.describe("history", () => {
  test("lists the fixture sessions with their evidence and links to a result", async ({ page }) => {
    await page.goto("/history");

    await expect(page.getByTestId("history-list")).toBeVisible();
    const rows = page.locator('[data-testid^="history-row-"]');
    await expect(rows).not.toHaveCount(0);

    // The row carries what doc 25 §25.12 lists: date, game, DPI, cm/360, confidence, profile.
    const first = rows.first();
    await expect(first).toContainText("Counter-Strike 2");
    await expect(first).toContainText("800 DPI");
    await expect(first).toContainText(/\d+\/100/);
    await expect(first).toContainText("Fixture desk");

    // And a session opens its own result page.
    await page.locator('[data-testid^="open-"]').first().click();
    await expect(page).toHaveURL(/\/results\//);
    await expect(page.getByTestId("algorithm-versions")).toBeVisible();
  });

  test("compares two sessions and states whether the change is real", async ({ page }) => {
    await page.goto("/history");
    const boxes = page.locator('[data-testid^="compare-"]');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.getByTestId("compare-selected").click();

    await expect(page).toHaveURL(/\/history\/compare\?a=.+&b=.+/);
    await expect(page.getByTestId("comparison-headline")).toBeVisible();
    await expect(page.getByTestId("comparison-table")).toBeVisible();
    await expect(page.getByTestId("change-statement")).toBeVisible();

    // Every fixture session ran on one profile at one DPI, so these are comparable and the
    // page must not invent a flag; the verdict is one of the three defined readings.
    await expect(page.getByTestId("comparability-flag")).toHaveCount(0);
    const headline = await page.getByTestId("comparison-headline").innerText();
    expect([
      "A MEASURABLE CHANGE",
      "WITHIN THE NOISE OF THE METHOD",
      "NOTHING TO COMPARE",
    ]).toContain(headline);

    // A within-noise verdict says so in the words doc 17 §17.9 requires.
    if (headline === "WITHIN THE NOISE OF THE METHOD") {
      await expect(page.getByTestId("change-statement")).toContainText("within the noise");
    }
  });

  test("is a 404 for a comparison the account does not own", async ({ page }) => {
    const response = await page.goto(
      "/history/compare?a=00000000-0000-7000-8000-000000000001&b=00000000-0000-7000-8000-000000000002",
    );
    expect(response?.status()).toBe(404);
  });
});

test.describe("hardware profiles", () => {
  test("lists the saved setup and offers it when calibrating", async ({ page }) => {
    await page.goto("/hardware-profiles");
    await expect(page.getByTestId(`profile-${fixtures.hardwareProfileId}`)).toContainText(
      "Fixture desk",
    );
    await expect(page.getByTestId(`profile-${fixtures.hardwareProfileId}`)).toContainText(
      "800 DPI",
    );

    // The calibrate form offers it, prefilled — a saved setup is not retyped every session.
    await page.goto("/calibrate");
    const picker = page.getByTestId("input-hardware-profile");
    await expect(picker).toBeVisible();
    await expect(picker).toHaveValue(fixtures.hardwareProfileId);
    await expect(page.getByTestId("input-dpi")).toHaveValue("800");
    await expect(page.getByTestId("input-pad-width")).toHaveValue("45");
  });

  test("creates and deletes a setup, saying what deletion keeps", async ({ page }) => {
    await page.goto("/hardware-profiles");
    await page.getByTestId("add-profile").click();
    await page.getByTestId("profile-name").fill("Laptop setup");
    await page.getByTestId("profile-dpi").fill("1600");
    await page.getByTestId("profile-save").click();

    const created = page.locator('article[data-testid^="profile-"]', { hasText: "Laptop setup" });
    await expect(created).toBeVisible();
    await expect(page.getByText("Deleting keeps your history readable")).toBeVisible();

    await created.getByRole("button", { name: "Delete" }).click();
    await expect(
      page.locator('article[data-testid^="profile-"]', { hasText: "Laptop setup" }),
    ).toHaveCount(0);
  });
});

test.describe("the account screens", () => {
  test("shows the account and warns what a password change does", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByTestId("account-email")).toContainText(fixtures.email);
    await expect(page.getByTestId("save-password")).toContainText(/sign out everywhere/i);
  });

  test("explains that deletion is scheduled, not instant", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("export-data")).toBeVisible();
    await page.getByTestId("start-deletion").click();
    await expect(page.getByTestId("deletion-confirm")).toBeVisible();
    await expect(page.getByTestId("confirm-deletion")).toContainText(/Delete in 30 days/);
    // The password is required before anything is scheduled.
    await expect(page.getByTestId("confirm-deletion")).toBeDisabled();
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sends a visitor to sign in rather than showing an empty account screen", async ({
    page,
  }) => {
    for (const path of ["/history", "/hardware-profiles", "/profile", "/settings"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/auth\/sign-in/);
    }
  });
});

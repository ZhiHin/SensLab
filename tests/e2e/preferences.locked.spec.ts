import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { AUTH_STATE } from "./auth-state";

/**
 * Display preferences end to end (FR-103, FR-105).
 *
 * ## Why this file runs alone
 *
 * These tests change a preference **on the shared fixture account** and then read a page that
 * renders it. Every other spec reads that same account, so run in parallel they would see
 * inches where they expected centimetres — a failure in a spec that changed nothing, which is
 * the most expensive kind to debug.
 *
 * The `locked` project runs after the parallel ones and one file at a time, which is the same
 * reason the pointer-lock specs live there: shared, mutable, externally-visible state.
 */

interface Fixtures {
  readonly recommendations: Record<string, string>;
}

const fixtures = JSON.parse(readFileSync("test-results/e2e-fixtures.json", "utf8")) as Fixtures;

test.use({ storageState: AUTH_STATE });

test("switches the displayed unit without changing the measurement", async ({ page }) => {
  await page.goto(`/results/${fixtures.recommendations["peak_found"]}`);
  const inCentimetres = await page.getByTestId("recommended-cm").innerText();

  await page.goto("/settings");
  await page.getByTestId("unit-preference-imperial").check();
  // The confirmation is what says the change reached the server; the control itself is
  // optimistic, so asserting on it alone would pass before anything was stored.
  await expect(page.getByTestId("preferences-status")).toHaveText("Saved");

  await page.goto(`/results/${fixtures.recommendations["peak_found"]}`);
  const inInches = await page.getByTestId("recommended-cm").innerText();
  expect(inInches).not.toBe(inCentimetres);
  // 2.54 cm to the inch, within the rounding both readings carry. The stored value did not
  // change — only how it is read.
  expect(Number(inInches)).toBeCloseTo(Number(inCentimetres) / 2.54, 1);
  await expect(page.locator("main")).toContainText("in / 360°");

  await page.goto("/settings");
  await page.getByTestId("unit-preference-metric").check();
  await expect(page.getByTestId("preferences-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("unit-preference-metric")).toBeChecked();
});

test("switches the game-facing surface to Simplified Chinese — FR-105", async ({ page }) => {
  await page.goto("/settings");
  await page.getByTestId("locale-preference-zh-Hans").check();
  await expect(page.getByTestId("preferences-status")).toHaveText("Saved");

  await page.goto(`/results/${fixtures.recommendations["peak_found"]}/settings`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("你的设置");
  // The language is announced, not merely rendered (doc 28 §28.10).
  await expect(page.locator("main")).toHaveAttribute("lang", /^zh-Hans/);
  // The game's own name stays in the language that game uses (doc 08 §8.7).
  await expect(page.getByTestId("switch-cs2")).toBeVisible();

  await page.goto("/settings");
  await page.getByTestId("locale-preference-en").check();
  await expect(page.getByTestId("preferences-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("locale-preference-en")).toBeChecked();
});

test("honours the motion override in the stylesheet", async ({ page }) => {
  await page.goto("/settings");
  await page.getByTestId("motion-preference-reduced").check();
  await expect(page.getByTestId("preferences-status")).toHaveText("Saved");

  await page.goto("/");
  // The preference reaches the document, which is what the stylesheet keys off — the override
  // has to work without the operating system agreeing (`SENS-UX-023`).
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");

  await page.goto("/settings");
  await page.getByTestId("motion-preference-system").check();
  await expect(page.getByTestId("preferences-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("motion-preference-system")).toBeChecked();
});

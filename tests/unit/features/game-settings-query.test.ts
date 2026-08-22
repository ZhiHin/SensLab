import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS_QUERY,
  parseSettingsQuery,
  settingsQuerySchema,
} from "@/features/game-settings/contracts";
import { STATUS_COPY, REFUSAL_COPY } from "@/features/game-settings/copy";
import { VERIFICATION_STATUSES } from "@/core/types/vocabulary";

/**
 * The settings surface's input handling.
 *
 * A conversion page is a read, so a malformed link should render sensible defaults rather
 * than an error: nothing is mutated, and every number is re-derived on each request.
 */

describe("parsing the query string", () => {
  it("reads a well-formed query", () => {
    const { query, usedDefaults } = parseSettingsQuery({
      cm360: "31.2",
      dpi: "1600",
      scope: "ads",
    });
    expect(usedDefaults).toBe(false);
    expect(query).toEqual({ cm360: 31.2, dpi: 1600, scope: "ads" });
  });

  it("defaults the scope to hipfire", () => {
    const { query } = parseSettingsQuery({ cm360: "30", dpi: "800" });
    expect(query.scope).toBe("hipfire");
  });

  it("falls back to defaults rather than throwing on nonsense", () => {
    for (const bad of [
      { cm360: "not-a-number", dpi: "800" },
      { cm360: "-5", dpi: "800" },
      { cm360: "30", dpi: "0" },
      { cm360: "30", dpi: "800", scope: "sniper-scope" },
    ]) {
      const { query, usedDefaults } = parseSettingsQuery(bad);
      expect(usedDefaults).toBe(true);
      expect(query).toEqual(DEFAULT_SETTINGS_QUERY);
    }
  });

  it("takes the first value when a parameter repeats", () => {
    const { query } = parseSettingsQuery({ cm360: ["25", "99"], dpi: "800" });
    expect(query.cm360).toBe(25);
  });

  it("accepts an optional half-FOV and rejects an impossible one", () => {
    expect(parseSettingsQuery({ cm360: "30", dpi: "800", halfFov: "51.5" }).query.halfFov).toBe(
      51.5,
    );
    expect(parseSettingsQuery({ cm360: "30", dpi: "800", halfFov: "120" }).usedDefaults).toBe(true);
  });

  it("rejects a DPI far outside anything a mouse reports", () => {
    expect(settingsQuerySchema.safeParse({ cm360: 30, dpi: 1e9 }).success).toBe(false);
    expect(settingsQuerySchema.safeParse({ cm360: 30, dpi: 40 }).success).toBe(false);
  });
});

describe("verification copy", () => {
  it("covers every verification status", () => {
    // A status with no copy would render blank, which reads as "no information" rather than
    // as the honest statement each of these states deserves.
    for (const status of VERIFICATION_STATUSES) {
      expect(STATUS_COPY[status]?.label).toBeTruthy();
      expect(STATUS_COPY[status]?.summary).toBeTruthy();
    }
  });

  it("names no game", () => {
    // Copy keyed by status, never by game: adding a game must not require editing prose.
    const prose = [
      ...Object.values(STATUS_COPY).map((entry) => `${entry.label} ${entry.summary}`),
      ...Object.values(REFUSAL_COPY),
    ]
      .join(" ")
      .toLowerCase();
    for (const term of ["counter-strike", "apex", "pubg", "delta force", "三角洲"]) {
      expect(prose).not.toContain(term);
    }
  });

  it("never suggests an approximate value is available", () => {
    const prose = Object.values(REFUSAL_COPY).join(" ").toLowerCase();
    for (const weasel of ["approximate", "estimate", "roughly", "should be about"]) {
      expect(prose).not.toContain(weasel);
    }
  });
});

import { z } from "zod";
import { SCOPE_KEYS } from "@/core/types/vocabulary";

export type { StatusTone } from "@/components/primitives";
export type { ConversionFailureCode } from "@/game-adapters";

/**
 * The settings surface's own input contract.
 *
 * The canonical sensitivity arrives as cm/360 and a DPI because those are the two numbers a
 * player has in front of them. Counts per 360 is derived from the pair rather than accepted
 * directly: it is the authoritative unit internally (doc 11 §11.1), but it is not a number
 * anyone types, and offering a field for it would invite a value with no DPI attached to give
 * it meaning.
 *
 * The bounds are the admissible product domain (doc 11 §11.10) widened enough to let someone
 * inspect a value just outside it, because this surface reports rather than decides.
 */
export const settingsQuerySchema = z.object({
  cm360: z.coerce.number().finite().gt(0).max(500),
  dpi: z.coerce.number().finite().gte(50).lte(64000),
  scope: z.enum(SCOPE_KEYS).default("hipfire"),
  /** Horizontal half-FOV, needed only for a FOV-matched scoped conversion. */
  halfFov: z.coerce.number().finite().gt(0).lt(90).optional(),
});

export type SettingsQuery = z.infer<typeof settingsQuerySchema>;

export const DEFAULT_SETTINGS_QUERY: SettingsQuery = {
  cm360: 30,
  dpi: 800,
  scope: "hipfire",
};

/**
 * Parses query parameters, falling back to the defaults rather than erroring.
 *
 * A malformed link should show the page with sensible values, not a stack trace: nothing here
 * mutates anything, and the numbers are re-derived on every render.
 */
export function parseSettingsQuery(input: Record<string, string | string[] | undefined>): {
  readonly query: SettingsQuery;
  readonly usedDefaults: boolean;
} {
  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

  const parsed = settingsQuerySchema.safeParse({
    cm360: first(input.cm360) ?? DEFAULT_SETTINGS_QUERY.cm360,
    dpi: first(input.dpi) ?? DEFAULT_SETTINGS_QUERY.dpi,
    scope: first(input.scope) ?? DEFAULT_SETTINGS_QUERY.scope,
    ...(first(input.halfFov) === undefined ? {} : { halfFov: first(input.halfFov) }),
  });

  return parsed.success
    ? { query: parsed.data, usedDefaults: false }
    : { query: DEFAULT_SETTINGS_QUERY, usedDefaults: true };
}

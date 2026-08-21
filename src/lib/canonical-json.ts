/**
 * Deterministic JSON serialisation.
 *
 * Used to hash versioned parameter sets (doc 14 §14.9). `JSON.stringify` preserves insertion
 * order, so two structurally identical objects built in different orders would hash
 * differently — which would make the boot-time integrity check fire spuriously. Sorting keys
 * makes the hash a function of the *content* alone.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError(`canonicalJson cannot serialise the non-finite number ${value}`);
    }
    if (typeof value === "bigint") return value.toString();
    return value;
  }

  if (Array.isArray(value)) return value.map(normalise);

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const out: Record<string, unknown> = {};
  for (const [key, item] of entries) out[key] = normalise(item);
  return out;
}

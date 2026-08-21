import { customType } from "drizzle-orm/pg-core";

/**
 * Column types PostgreSQL has and Drizzle does not ship out of the box.
 */

/**
 * `bytea` — raw bytes.
 *
 * Used for every stored token hash. Storing a hash as bytes rather than as hex text halves
 * the storage and, more importantly, makes it obvious at a glance in DBeaver that the column
 * is a digest and not a value anyone should try to read (doc 20 §20.3).
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * `citext` — case-insensitive text.
 *
 * Email uniqueness must be case-insensitive; doing it in the column type rather than by
 * lower-casing at every call site means no code path can forget.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return "citext";
  },
});

import { SESSION_QUALITY_FLAGS, type SessionQualityFlag } from "@/core/types/vocabulary";

/** Keeps only the quality flags the vocabulary knows; anything else from the client is dropped. */
export function knownQualityFlags(flags: readonly string[]): SessionQualityFlag[] {
  return flags.filter((flag): flag is SessionQualityFlag =>
    (SESSION_QUALITY_FLAGS as readonly string[]).includes(flag),
  );
}

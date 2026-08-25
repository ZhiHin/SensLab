/**
 * The client address, read from `X-Forwarded-For` at the position the deployment says is
 * trustworthy (`SENS-SEC-011`).
 *
 * ## Why not simply take the first entry
 *
 * `X-Forwarded-For` is a comma-separated list that every hop **appends** to. A request that
 * passed through one proxy arrives as:
 *
 * ```
 * X-Forwarded-For: <whatever the client sent>, <the address the proxy saw>
 * ```
 *
 * The rightmost entry is the only one written by infrastructure we control; everything left of
 * it was supplied by the caller. A client can therefore send its own `X-Forwarded-For` header
 * and have the proxy append to it, so reading the leftmost entry reads a value the attacker
 * chose. Since that value keys the per-IP rate limits on registration, sign-in and password
 * reset, varying it per request would defeat all three.
 *
 * The number of hops is configuration rather than a guess, because only the deployment knows
 * its own topology. It is passed in rather than read here so that parsing a header does not
 * require a fully validated environment — this stays a pure function of its inputs.
 */
export function clientAddressFrom(
  forwardedFor: string | null,
  trustedProxyHops: number,
): string | undefined {
  if (forwardedFor === null) return undefined;

  const entries = forwardedFor
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) return undefined;

  const hops = trustedProxyHops;
  // With no trusted proxy the header is entirely client-supplied and carries no evidence, so
  // it is not used at all rather than used badly.
  if (hops === 0) return undefined;

  // Configured for more hops than actually arrived: every entry is from a trusted hop, so the
  // leftmost is the furthest upstream this deployment can see. Erring this way keeps a
  // misconfiguration from promoting a forged entry.
  const index = Math.max(0, entries.length - hops);
  return entries[index];
}

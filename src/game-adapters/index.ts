import { AdapterRegistry } from "./registry";
import { LAUNCH_ADAPTERS } from "./launch-games";

export * from "./types";
export * from "./registry";
export * from "./unverified";
export * from "./launch-games";

/**
 * Builds a registry containing the launch roster.
 *
 * A factory rather than a module-level singleton so that tests can construct isolated
 * registries, and so that registration order and current-version selection stay explicit.
 */
export function createLaunchRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  for (const adapter of LAUNCH_ADAPTERS) {
    registry.register(adapter, { isCurrent: true });
  }
  return registry;
}

/** The registry the application uses. */
export const gameAdapterRegistry: AdapterRegistry = createLaunchRegistry();

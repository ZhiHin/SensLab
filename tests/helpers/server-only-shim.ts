/**
 * Test shim for the `server-only` package.
 *
 * `server-only` exists to make a build fail when a server module is pulled into a client
 * bundle. Under Vitest there is no such bundle, and its default export throws on import — so
 * the integration suite aliases it here. The guarantee it protects is enforced at build time
 * by Next, which is where it belongs; nothing is weakened by shimming it in tests.
 */
export {};

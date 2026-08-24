/**
 * Where the setup project saves the fixture account's signed-in session.
 *
 * A plain module rather than an export from the setup spec: Playwright forbids a test file
 * importing another test file, and the path is shared by every spec that needs the account.
 */
export const AUTH_STATE = "test-results/e2e-auth.json";

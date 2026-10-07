/**
 * Accept only the disposable local PostgreSQL test database for integration
 * tests. Reject before opening a connection, and never include credentials in
 * an error message.
 */
export function localTestDatabaseUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL must target the local test database");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.pathname !== "/kneeboard_test" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("TEST_DATABASE_URL must target the local test database");
  }
  return value;
}

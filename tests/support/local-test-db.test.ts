import { describe, expect, it } from "vitest";

import { localTestDatabaseUrl } from "./local-test-db";

describe("local PostgreSQL test target", () => {
  it("accepts the configured loopback test database", () => {
    const url = "postgresql://pilot:local-password@127.0.0.1:54329/kneeboard_test";
    expect(localTestDatabaseUrl(url)).toBe(url);
    expect(localTestDatabaseUrl(undefined)).toBeUndefined();
  });

  it("rejects nonlocal hosts, other databases, and connection overrides", () => {
    for (const url of [
      "postgresql://pilot:secret@db.example.invalid/kneeboard_test",
      "postgresql://pilot:secret@127.0.0.1:54329/kneeboard_dev",
      "postgresql://pilot:secret@127.0.0.1:54329/kneeboard_test?host=db.example.invalid",
      "not a database url",
    ]) {
      expect(() => localTestDatabaseUrl(url)).toThrowError(
        "TEST_DATABASE_URL must target the local test database",
      );
    }
  });
});

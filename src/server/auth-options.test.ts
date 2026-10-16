import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";

import * as schema from "../db/schema";
import { parseServerConfig } from "./config";
import { createAuthOptions, guardedMagicLinkSender } from "./auth-options";

const config = parseServerConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://local:local@127.0.0.1:54329/kneeboard_test",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-only-unique-secret-with-32-characters",
  AUTH_EMAIL_ALLOWLIST: "pilot@example.invalid",
  MAIL_FROM_EMAIL: "login@kneeboard.local",
  MAIL_DELIVERY: "mailpit",
  MAILPIT_SMTP_HOST: "127.0.0.1",
  MAILPIT_SMTP_PORT: "1025",
});
const pool = new Pool({ connectionString: config.DATABASE_URL });
const database = drizzle(pool, { schema });
afterAll(async () => { await pool.end(); });

describe("Better Auth policy", () => {
  it("uses explicit database-backed magic-link, session, rate-limit, and telemetry settings", () => {
    const options = createAuthOptions(config, database, vi.fn());
    expect(options.database).toBeTypeOf("function");
    expect(options.plugins[0].id).toBe("magic-link");
    expect(options.session).toEqual({ expiresIn: 604800, updateAge: 86400 });
    expect(options.rateLimit).toEqual({ enabled: true, storage: "database" });
    expect(options.telemetry).toEqual({ enabled: false });
  });

  it("sends an allowed link and silently skips a disallowed address", async () => {
    const deliver = vi.fn(async () => {});
    const revoke = vi.fn(async () => {});
    const send = guardedMagicLinkSender(config, deliver, revoke);
    await expect(send({ email: "Pilot@Example.Invalid", url: "http://localhost:3000/link-a", token: "token-a" })).resolves.toBeUndefined();
    expect(deliver).toHaveBeenCalledExactlyOnceWith("Pilot@Example.Invalid", "http://localhost:3000/link-a");
    await expect(send({ email: "other@example.invalid", url: "http://localhost:3000/link-b", token: "token-b" })).resolves.toBeUndefined();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("revokes a failed delivery and keeps the error generic", async () => {
    const revoke = vi.fn(async () => {});
    const send = guardedMagicLinkSender(config, async () => { throw new Error("private provider detail"); }, revoke);
    await expect(send({ email: "pilot@example.invalid", url: "http://localhost:3000/link", token: "synthetic-token" }))
      .rejects.toThrow(/^Magic-link delivery failed$/);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("synthetic-token");
  });

  it("refuses account creation through the database hook for a disallowed address", async () => {
    const options = createAuthOptions(config, database, vi.fn());
    const before = options.databaseHooks.user.create.before;
    await expect(before({ email: "other@example.invalid" })).rejects.toMatchObject({ status: "FORBIDDEN" });
    await expect(before({ email: "pilot@example.invalid" })).resolves.toEqual({ data: { email: "pilot@example.invalid" } });
  });
});

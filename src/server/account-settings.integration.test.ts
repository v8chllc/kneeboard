import { betterAuth } from "better-auth";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { localTestDatabaseUrl } from "../../tests/support/local-test-db";
import * as schema from "../db/schema";
import { createAccountSettingsOperations, resolveAccountId } from "./account-settings-operations";
import { createAuthOptions } from "./auth-options";
import { parseServerConfig } from "./config";

const url = localTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const isolated = Boolean(url) && process.env.AUTH_JOURNEY_ISOLATED === "1";
const pool = isolated ? new Pool({ connectionString: url }) : undefined;
const database = pool ? drizzle(pool, { schema }) : undefined;
afterAll(async () => { await pool?.end(); });

describe.runIf(isolated)("account-scoped Pilot ID operations", () => {
  it("requires a real session, preserves leading zeros, and isolates two accounts", async () => {
    const config = parseServerConfig({
      NODE_ENV: "test", DATABASE_URL: url, BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "integration-only-secret-with-32-characters",
      AUTH_EMAIL_ALLOWLIST: "first@example.invalid,second@example.invalid",
      MAIL_FROM_EMAIL: "login@kneeboard.local", MAIL_DELIVERY: "mailpit",
      MAILPIT_SMTP_HOST: "127.0.0.1", MAILPIT_SMTP_PORT: "1025",
    });
    const links = new Map<string, string>();
    const auth = betterAuth(createAuthOptions(config, database!, async (email, link) => {
      links.set(email, link);
    }));
    const operations = createAccountSettingsOperations(database!, auth);
    const signedOut = new Headers({ "x-user-id": "forged-account" });
    expect(await resolveAccountId(auth, signedOut)).toBeNull();
    await expect(operations.readPilotId(signedOut)).rejects.toThrow("Sign-in required");
    await expect(operations.savePilotId(signedOut, "000123")).rejects.toThrow("Sign-in required");
    expect(await database!.select().from(schema.accountSettings)).toHaveLength(0);

    async function signIn(email: string, ip: string): Promise<Headers> {
      const request = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": ip },
        body: JSON.stringify({ email }),
      }));
      expect(request.status).toBe(200);
      const link = links.get(email);
      expect(link).toBeDefined();
      const redemption = await auth.handler(new Request(link!, { headers: { "x-forwarded-for": ip } }));
      expect(redemption.headers.get("set-cookie")).toContain("session_token");
      const cookie = redemption.headers.get("set-cookie")!.split(";")[0];
      return new Headers({ cookie });
    }

    const first = await signIn("first@example.invalid", "192.0.2.40");
    const second = await signIn("second@example.invalid", "192.0.2.41");
    const firstId = await resolveAccountId(auth, first);
    const secondId = await resolveAccountId(auth, second);
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(firstId).not.toBe(secondId);

    expect(await operations.readPilotId(first)).toBeNull();
    await operations.savePilotId(first, "000123");
    expect((await operations.readPilotId(first)) === "000123").toBe(true);
    expect((await operations.readPilotId(second)) === null).toBe(true);
    await operations.savePilotId(second, "9876543210123456");
    expect((await operations.readPilotId(second)) === "9876543210123456").toBe(true);
    await operations.savePilotId(first, "0");
    expect((await operations.readPilotId(first)) === "0").toBe(true);
    expect((await operations.readPilotId(second)) === "9876543210123456").toBe(true);

    const firstRows = await database!.select().from(schema.accountSettings)
      .where(eq(schema.accountSettings.userId, firstId!));
    expect(firstRows).toHaveLength(1);
    expect(firstRows[0].pilotId === "0").toBe(true);
    for (const invalid of ["", "12345678901234567", "12a3", "-123", "１２３", 123, null]) {
      let error: unknown;
      try { await operations.savePilotId(first, invalid); } catch (caught) { error = caught; }
      // A database error can contain query parameters; keep failing output private.
      expect(error instanceof Error && error.message === "Pilot ID must contain 1–16 digits").toBe(true);
    }
    expect((await operations.readPilotId(first)) === "0").toBe(true);
    expect((await operations.readPilotId(second)) === "9876543210123456").toBe(true);

    // A supplied account hint cannot override the identity Better Auth verifies.
    first.set("x-user-id", secondId!);
    expect((await operations.readPilotId(first)) === "0").toBe(true);
    await operations.savePilotId(first, "0012");
    expect((await operations.readPilotId(second)) === "9876543210123456").toBe(true);

    await database!.delete(schema.session).where(eq(schema.session.userId, firstId!));
    expect(await resolveAccountId(auth, first)).toBeNull();
    await expect(operations.readPilotId(first)).rejects.toThrow("Sign-in required");
    await expect(operations.savePilotId(first, "123")).rejects.toThrow("Sign-in required");
  }, 30000);
});

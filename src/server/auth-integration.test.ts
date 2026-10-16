import { createHash } from "node:crypto";

import { betterAuth } from "better-auth";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";

import { localTestDatabaseUrl } from "../../tests/support/local-test-db";
import * as schema from "../db/schema";
import { parseServerConfig } from "./config";
import { createAuthOptions } from "./auth-options";
import { createMailDelivery } from "./mail-delivery";

const url = localTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const isolated = Boolean(url) && process.env.AUTH_JOURNEY_ISOLATED === "1";
const pool = isolated ? new Pool({ connectionString: url }) : undefined;
const database = pool ? drizzle(pool, { schema }) : undefined;
afterAll(async () => { await pool?.end(); });

describe.runIf(isolated).sequential("Better Auth isolated database", () => {
  it("issues a hashed, single-use link, guards delivery, and persists rate limits", async () => {
    const environment = {
      NODE_ENV: "test", DATABASE_URL: url,
      BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "integration-only-secret-with-32-characters",
      MAIL_FROM_EMAIL: "login@kneeboard.local",
      MAIL_DELIVERY: "mailpit", MAILPIT_SMTP_HOST: "127.0.0.1", MAILPIT_SMTP_PORT: "1025",
    };
    const config = parseServerConfig({ ...environment, AUTH_EMAIL_ALLOWLIST: "pilot@example.invalid" });
    const messages: { email: string; url: string }[] = [];
    const auth = betterAuth(createAuthOptions(config, database!, async (email, link) => {
      messages.push({ email, url: link });
    }));
    const request = (email: string, ip: string) => auth.handler(new Request(
      "http://localhost:3000/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": ip },
        body: JSON.stringify({ email }),
      },
    ));

    const requestedAt = Date.now();
    const allowed = await request("pilot@example.invalid", "192.0.2.10");
    expect(allowed.status).toBe(200);
    expect(messages).toHaveLength(1);
    const token = new URL(messages[0].url).searchParams.get("token");
    expect(token).toBeTruthy();
    const rows = await database!.select().from(schema.verification);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]).includes(token!)).toBe(false);
    expect(rows[0].expiresAt.getTime() - requestedAt).toBeGreaterThanOrEqual(299000);
    expect(rows[0].expiresAt.getTime() - requestedAt).toBeLessThanOrEqual(301000);

    const rejected = await request("other@example.invalid", "192.0.2.11");
    expect(rejected.status).toBe(allowed.status);
    expect(await rejected.text()).toBe(await allowed.text());
    expect(messages).toHaveLength(1);
    expect(await database!.select().from(schema.user).where(eq(schema.user.email, "other@example.invalid"))).toHaveLength(0);

    const first = await auth.handler(new Request(messages[0].url, { headers: { "x-forwarded-for": "192.0.2.12" } }));
    expect(first.headers.get("set-cookie")).toContain("session_token");
    expect(await database!.select().from(schema.user).where(eq(schema.user.email, "pilot@example.invalid"))).toHaveLength(1);
    const sessions = await database!.select().from(schema.session);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].expiresAt.getTime() - Date.now()).toBeGreaterThanOrEqual(604799000);
    expect(sessions[0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(604801000);
    const second = await auth.handler(new Request(messages[0].url, { headers: { "x-forwarded-for": "192.0.2.13" } }));
    expect(second.headers.has("set-cookie")).toBe(false);
    expect(second.headers.get("location")).toContain("INVALID_TOKEN");

    // Issue a synthetic link with a permissive instance, then redeem it through
    // the restricted instance to reach the account-creation hook for real.
    const bypassMessages: string[] = [];
    const permissive = betterAuth(createAuthOptions(
      parseServerConfig({ ...environment, AUTH_EMAIL_ALLOWLIST: "*" }), database!,
      async (_email, link) => { bypassMessages.push(link); },
    ));
    const bypassRequest = new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": "192.0.2.14" },
      body: JSON.stringify({ email: "other@example.invalid" }),
    });
    expect((await permissive.handler(bypassRequest)).status).toBe(200);
    expect(bypassMessages).toHaveLength(1);
    const guardedCreate = await auth.handler(new Request(bypassMessages[0], { headers: { "x-forwarded-for": "192.0.2.15" } }));
    expect(guardedCreate.headers.has("set-cookie")).toBe(false);
    expect(await database!.select().from(schema.user).where(eq(schema.user.email, "other@example.invalid"))).toHaveLength(0);

    for (let index = 0; index < 5; index += 1) {
      const response = await request("pilot@example.invalid", "192.0.2.20");
      expect(response.status).toBe(200);
    }
    const sixth = await request("pilot@example.invalid", "192.0.2.20");
    expect(sixth.status).toBe(429);
    expect(messages).toHaveLength(6);
    expect((await database!.select().from(schema.rateLimit)).some((row) => row.count >= 5)).toBe(true);
  }, 30000);

  it("returns the same link-request response for existing and new allowed accounts", async () => {
    const config = parseServerConfig({
      NODE_ENV: "test", DATABASE_URL: url,
      BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "integration-only-secret-with-32-characters",
      AUTH_EMAIL_ALLOWLIST: "existing@example.invalid,new@example.invalid",
      MAIL_FROM_EMAIL: "login@kneeboard.local",
      MAIL_DELIVERY: "mailpit", MAILPIT_SMTP_HOST: "127.0.0.1", MAILPIT_SMTP_PORT: "1025",
    });
    const links = new Map<string, string>();
    const auth = betterAuth(createAuthOptions(config, database!, async (email, link) => {
      links.set(email, link);
    }));
    const request = (email: string, ip: string) => auth.handler(new Request(
      "http://localhost:3000/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": ip },
        body: JSON.stringify({ email }),
      },
    ));

    await request("existing@example.invalid", "192.0.2.60");
    const seedLink = links.get("existing@example.invalid");
    if (!seedLink) throw new Error("Account setup did not issue a link");
    await auth.handler(new Request(seedLink));
    const existingRows = await database!.select().from(schema.user).where(eq(schema.user.email, "existing@example.invalid"));
    const newRows = await database!.select().from(schema.user).where(eq(schema.user.email, "new@example.invalid"));
    expect({ existing: existingRows.length, fresh: newRows.length }).toEqual({ existing: 1, fresh: 0 });
    links.clear();

    const existing = await request("existing@example.invalid", "192.0.2.61");
    const fresh = await request("new@example.invalid", "192.0.2.62");
    const observable = async (response: Response) => ({
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers].sort(([first], [second]) => first.localeCompare(second)),
      body: await response.text(),
    });
    expect(existing.status).toBe(200);
    expect(await observable(existing)).toEqual(await observable(fresh));
    expect([...links.keys()].sort()).toEqual(["existing@example.invalid", "new@example.invalid"]);
  }, 30000);

  it("atomically consumes one link across two auth instances", async () => {
    const config = parseServerConfig({
      NODE_ENV: "test", DATABASE_URL: url,
      BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "integration-only-secret-with-32-characters",
      AUTH_EMAIL_ALLOWLIST: "concurrent@example.invalid",
      MAIL_FROM_EMAIL: "login@kneeboard.local",
      MAIL_DELIVERY: "mailpit", MAILPIT_SMTP_HOST: "127.0.0.1", MAILPIT_SMTP_PORT: "1025",
    });
    const secondPool = new Pool({ connectionString: url });
    try {
      const links: string[] = [];
      const first = betterAuth(createAuthOptions(config, database!, async (_email, link) => {
        links.push(link);
      }));
      const second = betterAuth(createAuthOptions(config, drizzle(secondPool, { schema }), async () => {}));
      const issue = () => first.handler(new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": "192.0.2.50" },
        body: JSON.stringify({ email: "concurrent@example.invalid" }),
      }));
      expect((await issue()).status).toBe(200);
      expect(links).toHaveLength(1);
      expect((await first.handler(new Request(links[0]))).headers.has("set-cookie")).toBe(true);
      // Redeem the contested link for an existing account, so a user-email
      // uniqueness conflict cannot hide a second successful session creation.
      expect((await issue()).status).toBe(200);
      expect(links).toHaveLength(2);
      const contestedLink = links[1];
      const token = new URL(contestedLink).searchParams.get("token");
      expect(token).toBeTruthy();
      const identifier = createHash("sha256").update(token!).digest("hex");
      const sessionsForAccount = () => pool!.query(
        'select s.id from session s join "user" u on u.id=s.user_id where u.email=$1',
        ["concurrent@example.invalid"],
      );
      expect((await sessionsForAccount()).rows).toHaveLength(1);

      const lock = await pool!.connect();
      try {
        await lock.query("begin");
        const row = await lock.query("select id from verification where identifier=$1 for update", [identifier]);
        expect(row.rowCount).toBe(1);
        const redemptions = [first, second].map((auth, index) => auth.handler(new Request(contestedLink, {
          headers: { "x-forwarded-for": `192.0.2.${51 + index}` },
        })));
        let waiting = false;
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          const blocked = await pool!.query("select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%verification%'");
          if (new Set(blocked.rows.map((entry: { pid: number }) => entry.pid)).size >= 2) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await lock.query("commit");
        const responses = await Promise.all(redemptions);
        expect(waiting, "both auth instances must reach the verification row lock").toBe(true);
        if (responses.filter((response) => response.headers.has("set-cookie")).length !== 1) {
          console.log("JOURNEY atomic redemption session count: fail");
        }
        expect(responses.filter((response) => response.headers.has("set-cookie")).length).toBe(1);
        expect(responses.filter((response) => response.headers.get("location")?.includes("INVALID_TOKEN")).length).toBe(1);
      } finally {
        await lock.query("rollback");
        lock.release();
      }
      expect(await database!.select().from(schema.verification).where(eq(schema.verification.identifier, identifier))).toHaveLength(0);
      expect((await sessionsForAccount()).rows).toHaveLength(2);
      console.log("JOURNEY atomic redemption: pass");
    } finally {
      await secondPool.end();
    }
  }, 30000);

  it("leaves no redeemable link after a delivery failure", async () => {
    const chaos = process.env.MAILPIT_CHAOS_ISOLATED === "1";
    const config = parseServerConfig({
      NODE_ENV: "test", DATABASE_URL: url,
      BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "integration-only-secret-with-32-characters",
      AUTH_EMAIL_ALLOWLIST: "failure@example.invalid",
      MAIL_FROM_EMAIL: "login@kneeboard.local",
      MAIL_DELIVERY: "mailpit", MAILPIT_SMTP_HOST: "127.0.0.1",
      MAILPIT_SMTP_PORT: process.env.MAILPIT_JOURNEY_SMTP_PORT ?? "1025",
    });
    const captured: string[] = [];
    const smtp = chaos ? createMailDelivery(config) : undefined;
    const auth = betterAuth(createAuthOptions(config, database!, async (email, link) => {
      captured.push(link);
      if (smtp) return smtp(email, link);
      throw new Error("Synthetic delivery failure");
    }));
    const logged: string[] = [];
    const errorLog = vi.spyOn(console, "error").mockImplementation((...values) => { logged.push(values.join(" ")); });
    const warnLog = vi.spyOn(console, "warn").mockImplementation((...values) => { logged.push(values.join(" ")); });
    let response: Response;
    try {
      response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": "192.0.2.30" },
        body: JSON.stringify({ email: "failure@example.invalid" }),
      }));
    } finally {
      errorLog.mockRestore();
      warnLog.mockRestore();
    }
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(captured).toHaveLength(1);
    expect(logged.join(" ").includes("failure@example.invalid")).toBe(false);
    expect(logged.join(" ").includes(new URL(captured[0]).searchParams.get("token")!)).toBe(false);
    const responseBody = await response.text();
    expect(responseBody.includes("failure@example.invalid")).toBe(false);
    expect(responseBody.includes(new URL(captured[0]).searchParams.get("token")!)).toBe(false);
    const redemption = await auth.handler(new Request(captured[0], { headers: { "x-forwarded-for": "192.0.2.31" } }));
    expect(redemption.headers.has("set-cookie")).toBe(false);
    expect((await database!.select().from(schema.verification)).some(
      (row) => row.identifier === createHash("sha256").update(new URL(captured[0]).searchParams.get("token")!).digest("hex"),
    )).toBe(false);
    expect(await database!.select().from(schema.user).where(eq(schema.user.email, "failure@example.invalid"))).toHaveLength(0);
    if (chaos) {
      const response = await fetch(`http://127.0.0.1:${process.env.MAILPIT_JOURNEY_UI_PORT}/api/v1/messages`);
      expect(response.ok).toBe(true);
      expect((await response.json() as { messages: unknown[] }).messages).toHaveLength(0);
    }
  }, 30000);
});

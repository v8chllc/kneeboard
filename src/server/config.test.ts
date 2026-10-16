import { describe, expect, it } from "vitest";
import { isAllowedEmail, parseServerConfig } from "./config";

const local = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://local:local@127.0.0.1:54329/kneeboard_dev",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-only-unique-secret-with-32-characters",
  MAIL_FROM_EMAIL: "login@kneeboard.local",
  MAIL_DELIVERY: "mailpit",
  MAILPIT_SMTP_HOST: "127.0.0.1",
  MAILPIT_SMTP_PORT: "1025",
};

const production = {
  ...local,
  NODE_ENV: "production",
  BETTER_AUTH_URL: "https://kneeboard.v8ch.com",
  MAIL_DELIVERY: "resend",
  RESEND_API_KEY: "test-only-key",
  MAIL_FROM_EMAIL: "login@kneeboard.v8ch.com",
};

describe("server configuration", () => {
  it("fails closed for missing and empty allowlists", () => {
    for (const value of [undefined, ""]) {
      const config = parseServerConfig({ ...local, AUTH_EMAIL_ALLOWLIST: value });
      expect(isAllowedEmail(config, "person@example.com")).toBe(false);
    }
  });

  it("normalizes exact addresses and accepts a deliberate wildcard", () => {
    const config = parseServerConfig({ ...local, AUTH_EMAIL_ALLOWLIST: " A@Example.com , b@example.com " });
    expect(isAllowedEmail(config, "a@example.com")).toBe(true);
    expect(isAllowedEmail(config, "B@EXAMPLE.COM")).toBe(true);
    expect(isAllowedEmail(config, "other@example.com")).toBe(false);
    expect(isAllowedEmail(parseServerConfig({ ...local, AUTH_EMAIL_ALLOWLIST: "*" }), "other@example.com")).toBe(true);
    expect(isAllowedEmail(parseServerConfig({ ...local, AUTH_EMAIL_ALLOWLIST: "*" }), "invalid" )).toBe(false);
    expect(() => parseServerConfig({ ...local, AUTH_EMAIL_ALLOWLIST: "*,a@example.com" })).toThrow("Invalid server configuration");
  });

  it("rejects missing, published default, or placeholder secrets without exposing them", () => {
    for (const secret of [undefined, "better-auth-secret-12345678901234567890", "replace-with-random-32-character-secret"]) {
      expect(() => parseServerConfig({ ...local, BETTER_AUTH_SECRET: secret })).toThrow(/^Invalid server configuration$/);
    }
  });

  it("rejects non-canonical URLs, invalid database URLs, and remote local SMTP", () => {
    for (const change of [
      { BETTER_AUTH_URL: "http://localhost:3000/extra" },
      { BETTER_AUTH_URL: "https://example.com" },
      { DATABASE_URL: "https://example.com/database" },
      { MAILPIT_SMTP_HOST: "mail.example.com" },
    ]) {
      expect(() => parseServerConfig({ ...local, ...change })).toThrow("Invalid server configuration");
    }
  });

  it("rejects absent or malformed database, app, and sender values without exposing them", () => {
    const cases: { key: "DATABASE_URL" | "BETTER_AUTH_URL" | "MAIL_FROM_EMAIL"; value: string | undefined }[] = [
      { key: "DATABASE_URL", value: undefined },
      { key: "DATABASE_URL", value: "private-db-marker" },
      { key: "BETTER_AUTH_URL", value: undefined },
      { key: "BETTER_AUTH_URL", value: "private-app-marker" },
      { key: "MAIL_FROM_EMAIL", value: undefined },
      { key: "MAIL_FROM_EMAIL", value: "private-sender-marker" },
    ];
    for (const { key, value } of cases) {
      let error: unknown;
      try { parseServerConfig({ ...local, [key]: value }); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      if (value !== undefined) expect(message.includes(value)).toBe(false);
      expect(["Invalid server configuration", "Invalid URL"]).toContain(message);
    }
  });

  it("requires HTTPS, Resend delivery, credentials, and sender in production", () => {
    expect(parseServerConfig(production).MAIL_DELIVERY).toBe("resend");
    for (const change of [
      { BETTER_AUTH_URL: "http://kneeboard.v8ch.com" },
      { MAIL_DELIVERY: "mailpit" },
      { RESEND_API_KEY: undefined },
      { MAIL_FROM_EMAIL: undefined },
    ]) {
      expect(() => parseServerConfig({ ...production, ...change })).toThrow("Invalid server configuration");
    }
  });
});

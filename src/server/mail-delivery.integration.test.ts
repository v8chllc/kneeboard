import { describe, expect, it } from "vitest";

import { parseServerConfig } from "./config";
import { createMailDelivery } from "./mail-delivery";

const smtpPort = process.env.MAILPIT_JOURNEY_SMTP_PORT;
const uiPort = process.env.MAILPIT_JOURNEY_UI_PORT;
const isolated = process.env.MAILPIT_JOURNEY_ISOLATED === "1" && Boolean(smtpPort && uiPort);

describe.runIf(isolated)("local Mailpit SMTP", () => {
  it("captures one sign-in message through SMTP", async () => {
    const config = parseServerConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://local:local@127.0.0.1:54329/kneeboard_test",
      BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "mail-test-only-secret-with-32-characters",
      AUTH_EMAIL_ALLOWLIST: "pilot@example.invalid",
      MAIL_FROM_EMAIL: "login@kneeboard.local",
      MAIL_DELIVERY: "mailpit",
      MAILPIT_SMTP_HOST: "127.0.0.1",
      MAILPIT_SMTP_PORT: smtpPort,
    });
    await createMailDelivery(config)("pilot@example.invalid", "http://localhost:3000/synthetic-link");

    let count = -1;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${uiPort}/api/v1/messages`);
      expect(response.ok).toBe(true);
      const inbox = await response.json() as { messages: unknown[] };
      count = inbox.messages.length;
      if (count > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(count).toBe(1);
  }, 15000);
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseServerConfig } from "./config";
import { createMailDelivery } from "./mail-delivery";

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  smtpSend: vi.fn(),
  resendSend: vi.fn(),
}));

vi.mock("nodemailer", () => ({ default: { createTransport: mocks.createTransport } }));
vi.mock("resend", () => ({ Resend: class { emails = { send: mocks.resendSend }; } }));

const base = {
  DATABASE_URL: "postgresql://local:local@127.0.0.1:54329/kneeboard_test",
  BETTER_AUTH_SECRET: "test-only-unique-secret-with-32-characters",
  AUTH_EMAIL_ALLOWLIST: "pilot@example.invalid",
  MAIL_FROM_EMAIL: "login@kneeboard.local",
};
const local = parseServerConfig({
  ...base, NODE_ENV: "test", BETTER_AUTH_URL: "http://localhost:3000",
  MAIL_DELIVERY: "mailpit", MAILPIT_SMTP_HOST: "127.0.0.1", MAILPIT_SMTP_PORT: "1025",
});
const production = parseServerConfig({
  ...base, NODE_ENV: "production", BETTER_AUTH_URL: "https://kneeboard.v8ch.com",
  MAIL_DELIVERY: "resend", RESEND_API_KEY: "test-only-key",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTransport.mockReturnValue({ sendMail: mocks.smtpSend });
  mocks.smtpSend.mockResolvedValue({});
  mocks.resendSend.mockResolvedValue({ data: { id: "synthetic" }, error: null });
});

describe("magic-link mail delivery", () => {
  it("sends local links by loopback SMTP", async () => {
    await createMailDelivery(local)("pilot@example.invalid", "http://localhost:3000/link");
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "127.0.0.1", port: 1025, ignoreTLS: true,
    }));
    expect(mocks.smtpSend).toHaveBeenCalledExactlyOnceWith({
      from: "login@kneeboard.local", to: "pilot@example.invalid",
      subject: "Sign in to Kneeboard", text: "Open this link to sign in: http://localhost:3000/link",
    });
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it("sends production links through Resend", async () => {
    await createMailDelivery(production)("pilot@example.invalid", "https://kneeboard.v8ch.com/link");
    expect(mocks.resendSend).toHaveBeenCalledExactlyOnceWith({
      from: "login@kneeboard.local", to: "pilot@example.invalid",
      subject: "Sign in to Kneeboard", text: "Open this link to sign in: https://kneeboard.v8ch.com/link",
    });
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it("returns one generic error for SMTP and Resend failures", async () => {
    mocks.smtpSend.mockRejectedValueOnce(new Error("recipient and link are private"));
    await expect(createMailDelivery(local)("pilot@example.invalid", "http://localhost:3000/link"))
      .rejects.toThrow(/^Magic-link delivery failed$/);
    mocks.resendSend.mockResolvedValueOnce({ data: null, error: { message: "private provider detail" } });
    await expect(createMailDelivery(production)("pilot@example.invalid", "https://kneeboard.v8ch.com/link"))
      .rejects.toThrow(/^Magic-link delivery failed$/);
  });
});

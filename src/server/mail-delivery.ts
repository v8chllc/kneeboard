import nodemailer from "nodemailer";
import { Resend } from "resend";

import type { ServerConfig } from "./config";

const subject = "Sign in to Kneeboard";

/** Deliver one sign-in URL through the configured server-only mail adapter. */
export function createMailDelivery(config: ServerConfig): (email: string, url: string) => Promise<void> {
  if (config.MAIL_DELIVERY === "mailpit") {
    const transport = nodemailer.createTransport({
      host: config.MAILPIT_SMTP_HOST,
      port: config.MAILPIT_SMTP_PORT,
      secure: false,
      ignoreTLS: true,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
    });
    return async (email, url) => {
      try {
        await transport.sendMail({ from: config.MAIL_FROM_EMAIL, to: email, subject, text: `Open this link to sign in: ${url}` });
      } catch {
        throw new Error("Magic-link delivery failed");
      }
    };
  }

  const resend = new Resend(config.RESEND_API_KEY);
  return async (email, url) => {
    try {
      const { error } = await resend.emails.send({
        from: config.MAIL_FROM_EMAIL,
        to: email,
        subject,
        text: `Open this link to sign in: ${url}`,
      });
      if (error) throw new Error("Resend rejected delivery");
    } catch {
      throw new Error("Magic-link delivery failed");
    }
  };
}

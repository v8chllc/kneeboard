import { z } from "zod";

const defaultSecret = "better-auth-secret-12345678901234567890";
const email = z.email();

const allowlist = z.string().optional().transform((value, context) => {
  if (!value?.trim()) return new Set<string>();
  const entries = value.split(",").map((entry) => entry.trim().toLowerCase());
  if (entries.length === 1 && entries[0] === "*") return "*" as const;
  if (entries.some((entry) => !email.safeParse(entry).success)) {
    context.addIssue({ code: "custom", message: "Invalid email allowlist" });
    return z.NEVER;
  }
  return new Set(entries);
});

const url = z.url().refine((value) => {
  const parsed = new URL(value);
  return !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === "/";
}, "Expected a canonical application URL without credentials, path, query, or fragment");

const rawSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url().refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol), "Expected a PostgreSQL URL"),
  BETTER_AUTH_URL: url,
  BETTER_AUTH_SECRET: z.string().min(32).refine((value) => value !== defaultSecret && !value.startsWith("replace-"), "Set a unique Better Auth secret"),
  AUTH_EMAIL_ALLOWLIST: allowlist,
  MAIL_FROM_EMAIL: z.email(),
  MAIL_DELIVERY: z.enum(["mailpit", "resend"]),
  MAILPIT_SMTP_HOST: z.string().optional(),
  MAILPIT_SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  RESEND_API_KEY: z.string().optional(),
}).superRefine((config, context) => {
  const appUrl = new URL(config.BETTER_AUTH_URL);
  if (config.NODE_ENV === "production") {
    if (appUrl.protocol !== "https:" || config.MAIL_DELIVERY !== "resend") {
      context.addIssue({ code: "custom", message: "Production requires HTTPS and Resend" });
    }
    if (!config.RESEND_API_KEY?.trim()) {
      context.addIssue({ code: "custom", message: "Production requires Resend credentials and sender" });
    }
  } else {
    if (appUrl.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname)) {
      context.addIssue({ code: "custom", message: "Local application URL must use loopback HTTP" });
    }
    if (config.MAIL_DELIVERY !== "mailpit" || !["localhost", "127.0.0.1", "::1"].includes(config.MAILPIT_SMTP_HOST ?? "") || !config.MAILPIT_SMTP_PORT) {
      context.addIssue({ code: "custom", message: "Local mail delivery requires loopback Mailpit SMTP" });
    }
  }
});

export type ServerConfig = z.infer<typeof rawSchema>;

/** Validate server-only configuration before auth or account settings use it. */
export function parseServerConfig(environment: Record<string, string | undefined>): ServerConfig {
  const result = rawSchema.safeParse(environment);
  if (!result.success) {
    // Zod errors may contain rejected input values, including secrets.
    throw new Error("Invalid server configuration");
  }
  return result.data;
}

/** Test an email against the normalized, fail-closed server allowlist. */
export function isAllowedEmail(config: ServerConfig, address: string): boolean {
  const normalized = address.trim().toLowerCase();
  return email.safeParse(normalized).success && (config.AUTH_EMAIL_ALLOWLIST === "*" || config.AUTH_EMAIL_ALLOWLIST.has(normalized));
}

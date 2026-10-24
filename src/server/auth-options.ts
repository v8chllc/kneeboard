import { createHash } from "node:crypto";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { APIError } from "better-auth/api";
import { magicLink } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import { isAllowedEmail, type ServerConfig } from "./config";
import type { FailureLogger } from "./failure-logger-core";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Keep disallowed addresses indistinguishable at the delivery boundary. */
export function guardedMagicLinkSender(
  config: ServerConfig,
  deliver: (email: string, url: string) => Promise<void>,
  revoke: (token: string) => Promise<void>,
  logFailure?: FailureLogger,
) {
  return async ({ email, url, token }: { email: string; url: string; token: string }) => {
    if (!isAllowedEmail(config, email)) return;
    try {
      await deliver(email, url);
    } catch {
      logFailure?.({ severity: "error", event: "authentication_delivery_failure", errorCode: "AUTH_DELIVERY_FAILED" });
      try {
        await revoke(token);
      } catch {
        // The caller sees only a generic failure, even if cleanup fails.
      }
      throw new Error("Magic-link delivery failed");
    }
  };
}

/** Better Auth's complete database-backed policy, with delivery injected for tests. */
export function createAuthOptions(
  config: ServerConfig,
  database: NodePgDatabase<typeof schema>,
  deliver: (email: string, url: string) => Promise<void>,
  logFailure?: FailureLogger,
) {
  return {
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: drizzleAdapter(database, { provider: "pg", schema }),
    telemetry: { enabled: false },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, storage: "database" as const },
    databaseHooks: {
      user: {
        create: {
          before: async (user: { email: string }) => {
            if (!isAllowedEmail(config, user.email)) {
              throw new APIError("FORBIDDEN", { message: "Unable to complete sign-in" });
            }
            return { data: user };
          },
        },
      },
    },
    plugins: [magicLink({
      expiresIn: 300,
      // A documented custom hasher makes the exact row addressable for
      // revocation when delivery fails after Better Auth creates it.
      storeToken: { type: "custom-hasher", hash: async (token) => tokenHash(token) },
      rateLimit: { window: 60, max: 5 },
      sendMagicLink: guardedMagicLinkSender(config, deliver, async (token) => {
        // Better Auth 1.7.6 stores the documented custom-hasher result as the
        // verification identifier. The integration test protects this seam.
        await database.delete(schema.verification).where(
          eq(schema.verification.identifier, tokenHash(token)),
        );
      }, logFailure),
    })],
  };
}

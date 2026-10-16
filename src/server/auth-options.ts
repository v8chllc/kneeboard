import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { APIError } from "better-auth/api";
import { magicLink } from "better-auth/plugins";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import { isAllowedEmail, type ServerConfig } from "./config";

/** Keep disallowed addresses indistinguishable at the delivery boundary. */
export function guardedMagicLinkSender(
  config: ServerConfig,
  deliver: (email: string, url: string) => Promise<void>,
) {
  return async ({ email, url }: { email: string; url: string }) => {
    if (isAllowedEmail(config, email)) await deliver(email, url);
  };
}

/** Better Auth's complete database-backed policy, with delivery injected for tests. */
export function createAuthOptions(
  config: ServerConfig,
  database: NodePgDatabase<typeof schema>,
  deliver: (email: string, url: string) => Promise<void>,
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
      storeToken: "hashed",
      rateLimit: { window: 60, max: 5 },
      sendMagicLink: guardedMagicLinkSender(config, deliver),
    })],
  };
}

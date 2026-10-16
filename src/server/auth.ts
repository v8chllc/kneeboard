import "server-only";

import { betterAuth } from "better-auth";

import { createAuthOptions } from "./auth-options";
import { getDatabase } from "./database";
import { getServerConfig } from "./env";
import { createMailDelivery } from "./mail-delivery";

function createAuth() {
  const config = getServerConfig();
  return betterAuth(createAuthOptions(config, getDatabase(), createMailDelivery(config)));
}

let auth: ReturnType<typeof createAuth> | undefined;

/** Database-backed Better Auth instance shared by routes and server operations. */
export function getAuth(): ReturnType<typeof createAuth> {
  return auth ??= createAuth();
}

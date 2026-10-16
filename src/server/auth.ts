import "server-only";

import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../db/schema";
import { createAuthOptions } from "./auth-options";
import { getServerConfig } from "./env";
import { createMailDelivery } from "./mail-delivery";

function createAuth() {
  const config = getServerConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const database = drizzle(pool, { schema });
  return betterAuth(createAuthOptions(config, database, createMailDelivery(config)));
}

let auth: ReturnType<typeof createAuth> | undefined;

/** Database-backed Better Auth instance shared by routes and server operations. */
export function getAuth(): ReturnType<typeof createAuth> {
  return auth ??= createAuth();
}

import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../db/schema";
import { getServerConfig } from "./env";

let database: ReturnType<typeof createDatabase> | undefined;

function createDatabase() {
  const pool = new Pool({ connectionString: getServerConfig().DATABASE_URL });
  return drizzle(pool, { schema });
}

/** One validated, server-only database connection for auth and account settings. */
export function getDatabase(): ReturnType<typeof createDatabase> {
  return database ??= createDatabase();
}

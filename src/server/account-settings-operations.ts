import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import * as schema from "../db/schema";

const pilotIdSchema = z.string().regex(/^[0-9]{1,16}$/);

export interface SessionReader {
  api: { getSession: (options: { headers: Headers }) => Promise<{ user: { id: string } } | null> };
}

/** Resolve identity from a verified Better Auth session, never request data. */
export async function resolveAccountId(auth: SessionReader, headers: Headers): Promise<string | null> {
  const session = await auth.api.getSession({ headers });
  return session?.user.id ?? null;
}

async function requireAccountId(auth: SessionReader, headers: Headers): Promise<string> {
  const accountId = await resolveAccountId(auth, headers);
  if (accountId === null) throw new Error("Sign-in required");
  return accountId;
}

/** Every operation resolves its own account and scopes its own database query. */
export function createAccountSettingsOperations(database: NodePgDatabase<typeof schema>, auth: SessionReader) {
  return {
    async readPilotId(headers: Headers): Promise<string | null> {
      const accountId = await requireAccountId(auth, headers);
      const [row] = await database.select({ pilotId: schema.accountSettings.pilotId })
        .from(schema.accountSettings).where(eq(schema.accountSettings.userId, accountId)).limit(1);
      return row?.pilotId ?? null;
    },
    async savePilotId(headers: Headers, value: unknown): Promise<void> {
      const accountId = await requireAccountId(auth, headers);
      const parsed = pilotIdSchema.safeParse(value);
      if (!parsed.success) throw new Error("Pilot ID must contain 1–16 digits");
      await database.insert(schema.accountSettings).values({ userId: accountId, pilotId: parsed.data })
        .onConflictDoUpdate({
          target: schema.accountSettings.userId,
          set: { pilotId: parsed.data, updatedAt: sql`clock_timestamp()` },
        });
    },
  };
}

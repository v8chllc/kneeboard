import "server-only";

import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { loadOfpForAccount } from "../db/ofp-load";
import { accountSettings } from "../db/schema";
import { resolveAccountId } from "./account-settings";
import { getDatabase } from "./database";
import { logFailure } from "./failure-logger";
import { createLoadOperation } from "./ofp-load-operations";
import { fetchSimbriefOfp } from "./simbrief-ofp";

/** Production wiring: the database lookup is scoped by verified account ID. */
export function loadLatestOfp(headers: Headers, key: unknown) {
  const database = getDatabase();
  return createLoadOperation({
    resolveAccountId,
    async readPilotId(accountId) {
      const [row] = await database.select({ pilotId: accountSettings.pilotId })
        .from(accountSettings).where(eq(accountSettings.userId, accountId)).limit(1);
      return row?.pilotId ?? null;
    },
    load: (accountId, actionKey, work) => loadOfpForAccount(database as unknown as NodePgDatabase, accountId, actionKey, work),
    fetch: fetchSimbriefOfp,
    logFailure,
  })(headers, key);
}

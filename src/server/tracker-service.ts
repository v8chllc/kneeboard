import "server-only";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { mutateTracker } from "../db/tracker-operations";
import { resolveAccountId } from "./account-settings";
import { getDatabase } from "./database";
import { logFailure } from "./failure-logger";
import { selectTrackerForAccount } from "./tracker-data";
import { createTrackerTransport } from "./tracker-transport";

/** Bind tracker reads and mutations to verified sessions and one database. */
export function getTrackerTransport() {
  const database = getDatabase() as unknown as NodePgDatabase;
  return createTrackerTransport({
    resolveAccountId,
    read: (accountId, trackerId) => selectTrackerForAccount(database, accountId, trackerId),
    mutate: (accountId, trackerId, command) => mutateTracker(database, accountId, trackerId, command),
    logFailure,
  });
}

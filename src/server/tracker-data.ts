import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { ofpLoad, tracker } from "../db/schema";

export interface StoredTrackerView {
  readonly navlog: unknown;
  readonly snapshot: unknown;
  readonly version: number;
  readonly flightNumber: string;
  readonly originIcaoCode: string;
  readonly destinationIcaoCode: string;
  readonly generatedAt: Date;
  readonly loadedAt: Date;
}

/** Read only one account-owned tracker and header; raw OFP is never selected. */
export async function selectTrackerForAccount(
  db: NodePgDatabase,
  accountId: string,
  trackerId: string,
): Promise<StoredTrackerView | null> {
  const [row] = await db.select({
    navlog: tracker.navlog,
    snapshot: tracker.snapshot,
    version: tracker.version,
    flightNumber: ofpLoad.flightNumber,
    originIcaoCode: ofpLoad.originIcaoCode,
    destinationIcaoCode: ofpLoad.destinationIcaoCode,
    generatedAt: ofpLoad.generatedAt,
    loadedAt: ofpLoad.loadedAt,
  }).from(tracker).innerJoin(ofpLoad, and(
    eq(tracker.loadId, ofpLoad.id),
    eq(ofpLoad.userId, accountId),
  )).where(and(eq(tracker.id, trackerId), eq(tracker.userId, accountId))).limit(1);
  return row ?? null;
}

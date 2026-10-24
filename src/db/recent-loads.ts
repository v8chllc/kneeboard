import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { RecentLoadItem } from "../server/recent-load-contract";
import * as schema from "./schema";

const { ofpLoad, tracker } = schema;

/** Read only indexed metadata for the account's latest ten completed loads. */
export async function selectRecentLoadsForAccount(
  db: NodePgDatabase<typeof schema>,
  accountId: string,
): Promise<readonly RecentLoadItem[]> {
  const rows = await db.select({
    trackerId: tracker.id,
    flightNumber: ofpLoad.flightNumber,
    originIcaoCode: ofpLoad.originIcaoCode,
    destinationIcaoCode: ofpLoad.destinationIcaoCode,
    generatedAt: ofpLoad.generatedAt,
    loadedAt: ofpLoad.loadedAt,
  }).from(ofpLoad).innerJoin(tracker, and(
    eq(tracker.loadId, ofpLoad.id),
    eq(tracker.userId, accountId),
  )).where(eq(ofpLoad.userId, accountId))
    .orderBy(desc(ofpLoad.loadedAt), desc(ofpLoad.id)).limit(10);

  return rows.map((row) => ({
    trackerId: row.trackerId,
    flightNumber: row.flightNumber,
    originIcaoCode: row.originIcaoCode,
    destinationIcaoCode: row.destinationIcaoCode,
    generatedAtUtc: row.generatedAt.toISOString(),
    loadedAtUtc: row.loadedAt.toISOString(),
  }));
}

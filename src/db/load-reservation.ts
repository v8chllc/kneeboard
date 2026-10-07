import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { loadReservation, ofpLoad, tracker } from "./schema";

export type LoadReservationResult =
  | { readonly outcome: "claimed"; readonly acceptedAt: string }
  | { readonly outcome: "completed"; readonly trackerId: string }
  | { readonly outcome: "inProgress"; readonly remainingMs: number }
  | { readonly outcome: "wait"; readonly remainingMs: number };

/**
 * Reserve one account's explicit OFP load before any external work begins.
 * A completed same-key action wins before cooldown; an active same-key action
 * remains in progress. Only a claimed result permits the caller to fetch an
 * OFP. The claim is one database-time conditional upsert, so separate server
 * instances cannot both accept competing actions during the cooldown.
 *
 * `acceptedAt` is PostgreSQL timestamptz text, retaining microseconds for the
 * exact attempt match required by failure cleanup in the completion slice.
 */
export async function reserveOfpLoad(
  db: NodePgDatabase,
  accountId: string,
  idempotencyKey: string,
): Promise<LoadReservationResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [completed] = await db.select({ trackerId: tracker.id })
      .from(ofpLoad)
      .leftJoin(tracker, and(eq(tracker.loadId, ofpLoad.id), eq(tracker.userId, accountId)))
      .where(and(eq(ofpLoad.userId, accountId), eq(ofpLoad.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (completed) {
      if (completed.trackerId === null) throw new Error("incomplete persisted OFP load");
      return { outcome: "completed", trackerId: completed.trackerId };
    }

    const [claimed] = await db.insert(loadReservation).values({
      userId: accountId,
      activeKey: idempotencyKey,
      acceptedAt: sql`clock_timestamp()`,
    }).onConflictDoUpdate({
      target: loadReservation.userId,
      set: {
        activeKey: idempotencyKey,
        acceptedAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      },
      setWhere: sql`${loadReservation.acceptedAt} IS NULL OR ${loadReservation.acceptedAt} <= clock_timestamp() - interval '30 seconds'`,
    }).returning({ acceptedAt: sql<string>`${loadReservation.acceptedAt}::text` });
    if (claimed) return { outcome: "claimed", acceptedAt: claimed.acceptedAt };

    // Another request owns the current interval. Check completed again: its
    // transaction might have committed between our first lookup and claim.
    const [justCompleted] = await db.select({ trackerId: tracker.id })
      .from(ofpLoad)
      .leftJoin(tracker, and(eq(tracker.loadId, ofpLoad.id), eq(tracker.userId, accountId)))
      .where(and(eq(ofpLoad.userId, accountId), eq(ofpLoad.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (justCompleted) {
      if (justCompleted.trackerId === null) throw new Error("incomplete persisted OFP load");
      return { outcome: "completed", trackerId: justCompleted.trackerId };
    }

    const [current] = await db.select({
      activeKey: loadReservation.activeKey,
      remainingMs: sql<number>`greatest(0, ceil(extract(epoch from (${loadReservation.acceptedAt} + interval '30 seconds' - clock_timestamp())) * 1000))::integer`,
    }).from(loadReservation).where(eq(loadReservation.userId, accountId)).limit(1);
    if (current && current.remainingMs > 0) {
      return current.activeKey === idempotencyKey
        ? { outcome: "inProgress", remainingMs: current.remainingMs }
        : { outcome: "wait", remainingMs: current.remainingMs };
    }
    // The interval expired between the failed claim and this read. Retry it.
  }
  throw new Error("load reservation changed repeatedly; retry");
}

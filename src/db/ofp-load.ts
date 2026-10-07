import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import { createInitialSnapshot } from "../domain/engine";
import type { TrackerSnapshot } from "../domain/tracker";
import { reserveOfpLoad, type LoadReservationResult } from "./load-reservation";
import { navlogSchema, trackerSnapshotSchema } from "./tracker-json";
import { loadReservation, ofpLoad, ofpRaw, tracker } from "./schema";

const rawPayloadSchema = z.record(z.string(), z.json());

export interface PreparedOfpLoad {
  /** Complete JSON payload; section 8 supplies the provider boundary. */
  readonly rawPayload: unknown;
  /** Normalized primary navlog; section 8 supplies representation validation. */
  readonly navlog: unknown;
}

export type OfpLoadResult =
  | Exclude<LoadReservationResult, { outcome: "claimed" }>
  | { readonly outcome: "created"; readonly trackerId: string; readonly snapshot: TrackerSnapshot }
  | { readonly outcome: "failed" };

async function clearMatchingReservation(
  db: NodePgDatabase,
  accountId: string,
  key: string,
  acceptedAt: string,
): Promise<void> {
  try {
    await db.update(loadReservation).set({ activeKey: null, updatedAt: sql`clock_timestamp()` })
      .where(and(
        eq(loadReservation.userId, accountId),
        eq(loadReservation.activeKey, key),
        sql`${loadReservation.acceptedAt} = ${acceptedAt}::timestamptz`,
      ));
  } catch {
    throw new Error("OFP load reservation cleanup failed");
  }
}

async function completedTrackerId(
  db: NodePgDatabase,
  accountId: string,
  key: string,
): Promise<string | null> {
  const [row] = await db.select({ trackerId: tracker.id }).from(ofpLoad)
    .innerJoin(tracker, and(eq(tracker.loadId, ofpLoad.id), eq(tracker.userId, accountId)))
    .where(and(eq(ofpLoad.userId, accountId), eq(ofpLoad.idempotencyKey, key)))
    .limit(1);
  return row?.trackerId ?? null;
}

function isFinalDuplicateGuard(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint === "ofp_load_user_key_unique") return true;
    current = candidate.cause;
  }
  return false;
}

/**
 * Reserve, prepare, and persist one explicit account-scoped OFP load.
 * `work` runs only for a newly claimed attempt and must be bounded below the
 * 30-second reservation lifetime by section 8's real provider integration.
 * Raw JSON, metadata, and the initial tracker commit in one transaction. A
 * failed attempt clears only its own active key and retains acceptedAt so the
 * cooldown remains. No error includes OFP contents or account data.
 */
export async function loadOfpForAccount(
  db: NodePgDatabase,
  accountId: string,
  idempotencyKey: string,
  work: () => Promise<PreparedOfpLoad>,
): Promise<OfpLoadResult> {
  const reservation = await reserveOfpLoad(db, accountId, idempotencyKey);
  if (reservation.outcome !== "claimed") return reservation;

  let payload: z.infer<typeof rawPayloadSchema>;
  let navlog: z.infer<typeof navlogSchema>;
  let snapshot: TrackerSnapshot;
  let generatedAt: Date;
  try {
    const prepared = await work();
    const parsedPayload = rawPayloadSchema.safeParse(prepared.rawPayload);
    const parsedNavlog = navlogSchema.safeParse(prepared.navlog);
    if (!parsedPayload.success || !parsedNavlog.success) throw new Error("invalid OFP work result");
    payload = parsedPayload.data;
    navlog = parsedNavlog.data;
    generatedAt = new Date(navlog.metadata.generatedAtUnixSeconds * 1000);
    if (!Number.isFinite(generatedAt.getTime())) throw new Error("invalid OFP generation time");
    const parsedSnapshot = trackerSnapshotSchema.safeParse({
      ...createInitialSnapshot(navlog), version: 1,
    });
    if (!parsedSnapshot.success) throw new Error("invalid initial tracker");
    snapshot = parsedSnapshot.data;
  } catch {
    await clearMatchingReservation(db, accountId, idempotencyKey, reservation.acceptedAt);
    return { outcome: "failed" };
  }

  try {
    const createdTracker = await db.transaction(async (tx) => {
      const [load] = await tx.insert(ofpLoad).values({
        userId: accountId,
        idempotencyKey,
        flightNumber: navlog.metadata.flightNumber,
        originIcaoCode: navlog.metadata.originIcaoCode,
        destinationIcaoCode: navlog.metadata.destinationIcaoCode,
        generatedAt,
      }).returning({ id: ofpLoad.id });
      await tx.insert(ofpRaw).values({ loadId: load.id, payload });
      const [created] = await tx.insert(tracker).values({
        userId: accountId, loadId: load.id, navlog, snapshot, version: 1,
      }).returning({ id: tracker.id, snapshot: tracker.snapshot });
      const confirmedSnapshot = trackerSnapshotSchema.safeParse(created.snapshot);
      if (!confirmedSnapshot.success || confirmedSnapshot.data.version !== 1) {
        throw new Error("invalid initial tracker write");
      }
      await tx.update(loadReservation).set({ activeKey: null, updatedAt: sql`clock_timestamp()` })
        .where(and(
          eq(loadReservation.userId, accountId),
          eq(loadReservation.activeKey, idempotencyKey),
          sql`${loadReservation.acceptedAt} = ${reservation.acceptedAt}::timestamptz`,
        ));
      return { trackerId: created.id, snapshot: confirmedSnapshot.data };
    });
    return { outcome: "created", ...createdTracker };
  } catch (error) {
    await clearMatchingReservation(db, accountId, idempotencyKey, reservation.acceptedAt);
    if (isFinalDuplicateGuard(error)) {
      const existing = await completedTrackerId(db, accountId, idempotencyKey);
      if (existing !== null) return { outcome: "completed", trackerId: existing };
    }
    throw new Error("OFP load could not be saved");
  }
}

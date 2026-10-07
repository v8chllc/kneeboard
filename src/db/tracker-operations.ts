import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { TrackerCommand } from "../domain/commands";
import { applyCommand, type TrackerCommandResult } from "../domain/engine";
import type { TrackerSnapshot } from "../domain/tracker";
import { tracker } from "./schema";
import { parseTrackerData, trackerSnapshotSchema } from "./tracker-json";

export type TrackerMutationResult =
  | { readonly outcome: "applied"; readonly snapshot: TrackerSnapshot }
  | { readonly outcome: "stale"; readonly message: "tracker changed; reload and try again" }
  | { readonly outcome: "notFound" }
  | Extract<TrackerCommandResult, { outcome: "rejected" }>;

/** Atomically replace one account-owned snapshot when its column version matches. */
export async function compareAndSwapTrackerSnapshot(
  db: NodePgDatabase,
  accountId: string,
  trackerId: string,
  expectedVersion: number,
  proposed: TrackerSnapshot,
): Promise<TrackerSnapshot | null> {
  if (proposed.version !== expectedVersion) throw new Error("invalid tracker transition version");
  const candidate = trackerSnapshotSchema.safeParse({ ...proposed, version: expectedVersion + 1 });
  if (!candidate.success) throw new Error("invalid tracker transition data");
  const next = candidate.data;
  const [confirmed] = await db.update(tracker).set({
    snapshot: next,
    version: next.version,
    updatedAt: new Date(),
  }).where(and(
    eq(tracker.id, trackerId),
    eq(tracker.userId, accountId),
    eq(tracker.version, expectedVersion),
  )).returning({ snapshot: tracker.snapshot, version: tracker.version });
  if (!confirmed) return null;

  // The database result is authoritative even if a trigger or future schema
  // change alters the written value.
  const persisted = trackerSnapshotSchema.safeParse(confirmed.snapshot);
  if (!persisted.success || persisted.data.version !== confirmed.version) {
    throw new Error("invalid persisted tracker data");
  }
  return persisted.data;
}

/**
 * Apply one command to an account-owned tracker using one compare-and-swap write.
 * The caller supplies its authenticated account ID. A missing or unowned tracker
 * has the same result; a lost write race returns stale state without merging.
 * Persisted JSON is validated before entering the pure transition engine.
 */
export async function mutateTracker(
  db: NodePgDatabase,
  accountId: string,
  trackerId: string,
  command: TrackerCommand,
): Promise<TrackerMutationResult> {
  const [row] = await db.select({
    navlog: tracker.navlog,
    snapshot: tracker.snapshot,
    version: tracker.version,
  }).from(tracker).where(and(eq(tracker.id, trackerId), eq(tracker.userId, accountId))).limit(1);
  if (!row) return { outcome: "notFound" };

  const { navlog, snapshot } = parseTrackerData(row.navlog, row.snapshot, row.version);
  const result = applyCommand(navlog, snapshot, command);
  if (result.outcome === "rejected") {
    if (result.reason === "versionMismatch") {
      return { outcome: "stale", message: "tracker changed; reload and try again" };
    }
    return result;
  }

  const confirmed = await compareAndSwapTrackerSnapshot(
    db, accountId, trackerId, command.expectedVersion, result.snapshot,
  );
  if (!confirmed) return { outcome: "stale", message: "tracker changed; reload and try again" };
  return { outcome: "applied", snapshot: confirmed };
}

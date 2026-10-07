import { z } from "zod";

import type { Navlog } from "../domain/navlog";
import type { TrackerSnapshot } from "../domain/tracker";

const navlogPointSchema = z.strictObject({
  routeIndex: z.number().int().nonnegative(),
  ident: z.string(),
  sourceType: z.string(),
  classification: z.enum([
    "airport", "coordinateFix", "computedPoint", "sidFix", "starFix",
    "ambiguousProcedureFix", "enrouteFix", "unrecognized",
  ]),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  dis: z.number().finite().nonnegative().nullable(),
  rdis: z.number().finite().nonnegative(),
  isSynthesizedOrigin: z.boolean(),
});

export const navlogSchema: z.ZodType<Navlog> = z.strictObject({
  metadata: z.strictObject({
    generatedAtUnixSeconds: z.number().int().nonnegative(),
    flightNumber: z.string(),
    originIcaoCode: z.string(),
    destinationIcaoCode: z.string(),
    sidIdent: z.string(),
    starIdent: z.string(),
  }),
  points: z.array(navlogPointSchema).min(1),
});

export const trackerSnapshotSchema: z.ZodType<TrackerSnapshot> = z.strictObject({
  version: z.number().int().positive(),
  procedureInclusion: z.strictObject({ sid: z.boolean(), star: z.boolean() }),
  waypoints: z.array(z.strictObject({
    routeIndex: z.number().int().nonnegative(),
    state: z.enum(["queued", "pending", "saved", "passed", "skipped"]),
  })),
});

/** Parse untrusted JSONB without exposing its contents in an error. */
export function parseTrackerData(navlog: unknown, snapshot: unknown, version: number): {
  navlog: Navlog;
  snapshot: TrackerSnapshot;
} {
  const parsedNavlog = navlogSchema.safeParse(navlog);
  const parsedSnapshot = trackerSnapshotSchema.safeParse(snapshot);
  if (!parsedNavlog.success || !parsedSnapshot.success ||
      (parsedSnapshot.success && parsedSnapshot.data.version !== version)) {
    throw new Error("invalid persisted tracker data");
  }
  return { navlog: parsedNavlog.data, snapshot: parsedSnapshot.data };
}

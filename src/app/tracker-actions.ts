"use server";

import { headers } from "next/headers";

import { getTrackerTransport } from "@/server/tracker-service";
import type { TrackerCommandUiResult } from "@/server/tracker-transport";

/** Client supplies only the opaque tracker ID and typed command payload. */
export async function mutateTrackerAction(trackerId: unknown, command: unknown): Promise<TrackerCommandUiResult> {
  try {
    return await getTrackerTransport().command(await headers(), trackerId, command);
  } catch {
    return { status: "unreadable", message: "Tracker could not be updated. Reload and try again." };
  }
}

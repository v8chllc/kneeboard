import { z } from "zod";

import type { TrackerMutationResult } from "../db/tracker-operations";
import { parseTrackerData } from "../db/tracker-json";
import {
  type TrackerCommand,
  type TrackerCommandType,
} from "../domain/commands";
import type { TrackerCommandRejection } from "../domain/engine";
import type { Navlog } from "../domain/navlog";
import type { TrackerSnapshot } from "../domain/tracker";
import type { FailureLogger } from "./failure-logger-core";
import type { StoredTrackerView } from "./tracker-data";

export interface TrackerHeader {
  readonly flightNumber: string;
  readonly originIcaoCode: string;
  readonly destinationIcaoCode: string;
  readonly generatedAtUtc: string;
  readonly loadedAtUtc: string;
}

export type TrackerReadResult =
  | { readonly status: "found"; readonly navlog: Navlog; readonly snapshot: TrackerSnapshot; readonly header: TrackerHeader }
  | { readonly status: "notFound" | "signInRequired" | "unreadable"; readonly message: string };

export type TrackerCommandUiResult =
  | { readonly status: "applied"; readonly snapshot: TrackerSnapshot; readonly message: string }
  | { readonly status: "stale" | "notFound" | "signInRequired" | "unreadable"; readonly message: string }
  | { readonly status: "rejected"; readonly reason: Exclude<TrackerCommandRejection, "versionMismatch">; readonly message: string };

export interface TrackerTransportDependencies {
  readonly resolveAccountId: (headers: Headers) => Promise<string | null>;
  readonly read: (accountId: string, trackerId: string) => Promise<StoredTrackerView | null>;
  readonly mutate: (accountId: string, trackerId: string, command: TrackerCommand) => Promise<TrackerMutationResult>;
  readonly logFailure?: FailureLogger;
}

function logCommandFailure(logFailure: FailureLogger | undefined, stale = false): void {
  if (stale) {
    logFailure?.({ severity: "warning", event: "stale_version_conflict", errorCode: "STALE_VERSION" });
  } else {
    logFailure?.({ severity: "warning", event: "tracker_command_failure", errorCode: "TRACKER_COMMAND_FAILED" });
  }
}

const trackerIdSchema = z.uuid();
const base = { expectedVersion: z.number().int().positive() };
const routeIndex = z.number().int().nonnegative();
const commandSchemas = {
  saveWaypoint: z.strictObject({ type: z.literal("saveWaypoint"), routeIndex, ...base }),
  passWaypoint: z.strictObject({ type: z.literal("passWaypoint"), routeIndex, ...base }),
  skipWaypoint: z.strictObject({ type: z.literal("skipWaypoint"), routeIndex, ...base }),
  setProcedureInclusion: z.strictObject({ type: z.literal("setProcedureInclusion"), inclusion: z.strictObject({ sid: z.boolean(), star: z.boolean() }), ...base }),
} satisfies { [K in TrackerCommandType]: z.ZodType<Extract<TrackerCommand, { type: K }>> };
const commandTypes = Object.keys(commandSchemas) as TrackerCommandType[];
const commandSchemaOptions = commandTypes.map((type) => commandSchemas[type]);
const commandSchema = z.discriminatedUnion("type", commandSchemaOptions as [
  typeof commandSchemaOptions[number],
  ...Array<typeof commandSchemaOptions[number]>,
]);

function unreachable(value: never): never {
  void value;
  throw new Error("Unmapped tracker outcome");
}

/** Reject unknown command types separately from malformed known commands. */
export function parseTrackerCommand(
  input: unknown,
): Extract<TrackerCommandUiResult, { status: "rejected" }> | TrackerCommand {
  const parsed = commandSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  if (typeof input === "object" && input !== null && "type" in input && typeof input.type === "string" &&
      !commandTypes.includes(input.type as TrackerCommandType)) {
    return { status: "rejected", reason: "unknownCommand", message: "This tracker command is not recognized. Reload and try again." };
  }
  return { status: "rejected", reason: "malformedCommand", message: "This tracker command is invalid. Reload and try again." };
}

function mapRejection(reason: TrackerCommandRejection): TrackerCommandUiResult {
  switch (reason) {
    case "versionMismatch":
      return { status: "stale", message: "Tracker changed. Reload and try again." };
    case "unknownWaypoint":
      return { status: "rejected", reason, message: "This waypoint is not available. Reload and try again." };
    case "notEarliestPending":
      return { status: "rejected", reason, message: "Save the earliest pending waypoint first." };
    case "notPending":
      return { status: "rejected", reason, message: "This waypoint is not pending." };
    case "notSkippable":
      return { status: "rejected", reason, message: "This waypoint can no longer be skipped." };
    case "procedureControlsLocked":
      return { status: "rejected", reason, message: "SID and STAR controls lock after the first Save." };
    case "notSaved":
      return { status: "rejected", reason, message: "Save this waypoint before passing it." };
    case "unknownCommand":
      return { status: "rejected", reason, message: "This tracker command is not recognized. Reload and try again." };
    case "malformedCommand":
      return { status: "rejected", reason, message: "This tracker command is invalid. Reload and try again." };
    default:
      return unreachable(reason);
  }
}

/** Include a snapshot only after the account-scoped compare-and-swap confirms it. */
export function mapTrackerMutation(result: TrackerMutationResult): TrackerCommandUiResult {
  switch (result.outcome) {
    case "applied":
      return { status: "applied", snapshot: result.snapshot, message: "Tracker updated." };
    case "stale":
      return { status: "stale", message: "Tracker changed. Reload and try again." };
    case "notFound":
      return { status: "notFound", message: "Tracker not found." };
    case "rejected":
      return mapRejection(result.reason);
    default:
      return unreachable(result);
  }
}

/** The same not-found result covers absent and unowned tracker IDs. */
export function createTrackerTransport(dependencies: TrackerTransportDependencies) {
  return {
    async read(headers: Headers, trackerId: unknown): Promise<TrackerReadResult> {
      const parsedTrackerId = trackerIdSchema.safeParse(trackerId);
      try {
        const accountId = await dependencies.resolveAccountId(headers);
        if (accountId === null) return { status: "signInRequired", message: "Sign in to open a tracker." };
        if (!parsedTrackerId.success) return { status: "notFound", message: "Tracker not found." };
        const row = await dependencies.read(accountId, parsedTrackerId.data);
        if (row === null) return { status: "notFound", message: "Tracker not found." };
        const { navlog, snapshot } = parseTrackerData(row.navlog, row.snapshot, row.version);
        return { status: "found", navlog, snapshot, header: {
          flightNumber: row.flightNumber,
          originIcaoCode: row.originIcaoCode,
          destinationIcaoCode: row.destinationIcaoCode,
          generatedAtUtc: row.generatedAt.toISOString(),
          loadedAtUtc: row.loadedAt.toISOString(),
        } };
      } catch {
        dependencies.logFailure?.({ severity: "error", event: "unexpected_server_error", errorCode: "UNEXPECTED_SERVER_ERROR" });
        return { status: "unreadable", message: "Tracker could not be opened. Try again." };
      }
    },
    async command(headers: Headers, trackerId: unknown, input: unknown): Promise<TrackerCommandUiResult> {
      const parsedTrackerId = trackerIdSchema.safeParse(trackerId);
      try {
        const accountId = await dependencies.resolveAccountId(headers);
        if (accountId === null) return { status: "signInRequired", message: "Sign in to change a tracker." };
        if (!parsedTrackerId.success) {
          logCommandFailure(dependencies.logFailure);
          return { status: "notFound", message: "Tracker not found." };
        }
        const parsed = parseTrackerCommand(input);
        if ("status" in parsed) {
          logCommandFailure(dependencies.logFailure);
          return parsed;
        }
        const result = await dependencies.mutate(accountId, parsedTrackerId.data, parsed);
        if (result.outcome === "stale" || (result.outcome === "rejected" && result.reason === "versionMismatch")) {
          logCommandFailure(dependencies.logFailure, true);
        } else if (result.outcome === "rejected" || result.outcome === "notFound") {
          logCommandFailure(dependencies.logFailure);
        }
        return mapTrackerMutation(result);
      } catch {
        dependencies.logFailure?.({ severity: "error", event: "unexpected_server_error", errorCode: "UNEXPECTED_SERVER_ERROR" });
        return { status: "unreadable", message: "Tracker could not be updated. Reload and try again." };
      }
    },
  };
}

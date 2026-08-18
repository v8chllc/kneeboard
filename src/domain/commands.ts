/**
 * Typed tracker commands.
 *
 * Save, Pass, Skip, and pre-start SID/STAR inclusion changes are all applied
 * through the same pure, deterministic transition engine and the same
 * expected-version persistence path.
 *
 * Governed by `docs/tracker-behavior.md` §Domain implementation direction and
 * AGENTS.md §Architecture Guardrails.
 */

import type { ProcedureInclusion } from "./tracker";

/** Fields carried by every tracker command. */
export interface TrackerCommandBase {
  /**
   * The snapshot version the caller believes it is acting on. The engine
   * rejects a command whose expected version does not match the snapshot, so a
   * Pass preview never grants authority to mutate stale state. The engine does
   * not increment it; persistence assigns the next version on a successful
   * compare-and-swap write.
   */
  readonly expectedVersion: number;
}

/**
 * Record a fix as entered into every modeled INS unit. Only the earliest
 * pending fix in route order may be saved.
 */
export interface SaveWaypointCommand extends TrackerCommandBase {
  readonly type: "saveWaypoint";
  readonly routeIndex: number;
}

/**
 * Mark a saved fix passed. Passing cascades: every earlier saved-but-unpassed
 * fix is passed atomically, every affected slot except the newly passed fix's
 * is freed, and queued fixes are promoted into the freed slots.
 */
export interface PassWaypointCommand extends TrackerCommandBase {
  readonly type: "passWaypoint";
  readonly routeIndex: number;
}

/**
 * Mark a queued or pending fix as one that will not be entered. Skip is
 * terminal, consumes no slot, and renumbers all following slot and page
 * assignments.
 */
export interface SkipWaypointCommand extends TrackerCommandBase {
  readonly type: "skipWaypoint";
  readonly routeIndex: number;
}

/**
 * Change whether SID or STAR fixes are slot-eligible. Permitted only before the
 * first Save; the controls lock permanently for that tracker thereafter.
 */
export interface SetProcedureInclusionCommand extends TrackerCommandBase {
  readonly type: "setProcedureInclusion";
  readonly inclusion: ProcedureInclusion;
}

/** Every command the transition engine accepts. */
export type TrackerCommand =
  | SaveWaypointCommand
  | PassWaypointCommand
  | SkipWaypointCommand
  | SetProcedureInclusionCommand;

/** The discriminant of {@link TrackerCommand}. */
export type TrackerCommandType = TrackerCommand["type"];

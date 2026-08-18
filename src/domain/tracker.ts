/**
 * The mutable tracker snapshot.
 *
 * The snapshot is persisted whole and transitioned as one aggregate by the pure
 * transition engine. It holds plain serializable data only — no classes, no
 * `Map` or `Set`, no `Date` — because it round-trips through JSON and
 * deterministic replay depends on that round-trip being lossless.
 *
 * Governed by `docs/tracker-behavior.md` §State model, §Sliding window, and
 * AGENTS.md §Domain Invariants.
 */

/**
 * The lifecycle state of one eligible fix.
 *
 * ```text
 * queued  ────────> pending ────────> saved ────────> passed
 *    │                 │
 *    └────> skipped <──┘
 * ```
 *
 * `passed` and `skipped` are terminal. Points that are not slot-eligible carry
 * no state at all and never appear in {@link TrackerSnapshot.waypoints}.
 */
export type WaypointState = "queued" | "pending" | "saved" | "passed" | "skipped";

/**
 * The mutable state of one eligible fix, keyed by its stable route index.
 *
 * No slot is stored. A fix's slot follows determinately from its position in
 * the eligible sequence, and a saved fix's derived slot can never drift from
 * the slot it was written into: Skip applies only to queued or pending fixes,
 * and only the earliest pending fix may be saved, so no skip can ever occur
 * earlier in the route than a saved fix.
 */
export interface WaypointEntry {
  /** Index into `Navlog.points`. Stable across every renumbering. */
  readonly routeIndex: number;
  readonly state: WaypointState;
}

/**
 * Which procedures contribute slot-eligible fixes. Both default to included.
 * Changing either is a typed command and is permitted only before the first
 * Save; the controls lock permanently thereafter.
 */
export interface ProcedureInclusion {
  readonly sid: boolean;
  readonly star: boolean;
}

/**
 * The sliding window: the tracker's representation of current INS unit
 * contents, as the route indexes of the nine most recently saved fixes in route
 * order.
 *
 * It is a derived view, not stored snapshot state, because it follows
 * determinately from waypoint states: Save is route-ordered, so the window is
 * the last nine `saved`-or-`passed` fixes. Membership changes only on Save; Pass
 * never changes it. It is empty before the first Save, holds between one and
 * nine members afterwards, and is distinct from a page.
 */
export type SlidingWindow = readonly number[];

/**
 * The complete mutable tracker state.
 *
 * Slot assignment, page membership, the sliding window, and the permanent lock
 * on the procedure controls are all derived from these fields plus the
 * immutable navlog, which shares the same persisted tracker row, so derivation
 * never needs an extra fetch. Nothing derived is stored, so nothing stored can
 * disagree with what it derives from.
 */
export interface TrackerSnapshot {
  /**
   * The snapshot version used for optimistic concurrency. The transition engine
   * validates a command's expected version against this value and returns the
   * next state *without* incrementing it; a successful compare-and-swap write
   * assigns the new version in the persistence layer.
   */
  readonly version: number;
  readonly procedureInclusion: ProcedureInclusion;
  /**
   * Every slot-eligible fix, in original route order. Ineligible points are
   * absent: they are displayed from the navlog and hold no tracker state.
   */
  readonly waypoints: readonly WaypointEntry[];
}

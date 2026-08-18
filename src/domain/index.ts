/**
 * The framework-independent tracker domain.
 *
 * Nothing under `src/domain/` may import React, Next.js, or persistence code,
 * and nothing here performs I/O. Every module is unit-testable on its own.
 */

export type { OfpAirport, OfpInput, OfpNavlogFix } from "./ofp-input";

export type {
  KnownSourceType,
  Navlog,
  NavlogMetadata,
  NavlogPoint,
  NavlogPointClassification,
} from "./navlog";
export { KNOWN_SOURCE_TYPES } from "./navlog";

export type { SlotAvailability, SlotNumber } from "./slots";
export { SLOT_COUNT } from "./slots";

export type { Page } from "./pages";

export type {
  ProcedureInclusion,
  SlidingWindow,
  TrackerSnapshot,
  WaypointEntry,
  WaypointState,
} from "./tracker";

export type {
  PassWaypointCommand,
  SaveWaypointCommand,
  SetProcedureInclusionCommand,
  SkipWaypointCommand,
  TrackerCommand,
  TrackerCommandBase,
  TrackerCommandType,
} from "./commands";

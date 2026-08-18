/**
 * The framework-independent tracker domain.
 *
 * Nothing under `src/domain/` may import React, Next.js, or persistence code,
 * and nothing here performs I/O. Every module is unit-testable on its own.
 */

export type { OfpAirport, OfpInput, OfpNavlogFix } from "./ofp-input";

export type {
  CoordinatePresentation,
  Hemisphere,
  LatitudeHemisphere,
  LongitudeHemisphere,
  PositionPresentation,
} from "./coordinates";
export { formatLatitude, formatLongitude, formatPosition } from "./coordinates";

export type { ProcedureIdentifiers } from "./classification";
export {
  COORDINATE_FIX_IDENT_PATTERN,
  classifyFix,
  isSlotEligibleClassification,
} from "./classification";

export { buildNavlog } from "./navlog-construction";

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

import {
  areProcedureControlsLocked, buildPages, deriveEligibleSequenceForSnapshot,
  deriveSlidingWindow, deriveSlotAssignments, earliestPendingRouteIndex,
  formatPosition, slotByRouteIndex,
} from "../domain";
import type { Navlog, NavlogPoint, PositionPresentation, SlotNumber, TrackerSnapshot, WaypointState } from "../domain";
import { stateByRouteIndex } from "../domain/slot-state";

export type DisplayState = WaypointState | "ineligible";

export interface TrackerRowView {
  readonly routeIndex: number;
  readonly point: NavlogPoint;
  readonly state: DisplayState;
  readonly slot: SlotNumber | null;
  readonly badge: "outline" | "filled" | null;
  readonly position: PositionPresentation;
  readonly pageStart: number | null;
  readonly insideWindowRail: boolean;
  readonly railStart: boolean;
  readonly railEnd: boolean;
  readonly canSave: boolean;
  readonly canPass: boolean;
  readonly canSkip: boolean;
}

export interface TrackerViewModel {
  readonly rows: readonly TrackerRowView[];
  readonly pageCount: number;
  readonly windowVisible: boolean;
  readonly procedureControlsLocked: boolean;
}

/** Derive only display facts; page, slot, and window rules stay in the domain. */
export function buildTrackerView(navlog: Navlog, snapshot: TrackerSnapshot): TrackerViewModel {
  const assignments = deriveSlotAssignments(deriveEligibleSequenceForSnapshot(navlog, snapshot));
  const slots = slotByRouteIndex(assignments);
  const pages = buildPages(navlog, assignments);
  const pageStarts = new Map(pages.map((page) => [page.routeIndexes[0], page.pageNumber]));
  const states = stateByRouteIndex(snapshot);
  const window = deriveSlidingWindow(snapshot);
  const firstWindow = window[0];
  const lastWindow = window[window.length - 1];
  const earliest = earliestPendingRouteIndex(navlog, snapshot);

  const rows = navlog.points.map((point): TrackerRowView => {
    const routeIndex = point.routeIndex;
    const state = states.get(routeIndex) ?? "ineligible";
    const assigned = slots.get(routeIndex);
    // Once overwritten, a passed fix's old number no longer identifies what
    // the unit holds. Skipped and ineligible rows also hold no assignment.
    const evicted = state === "passed" && !window.includes(routeIndex);
    const slot = assigned !== undefined && !evicted ? assigned : null;
    const insideWindowRail = firstWindow !== undefined && lastWindow !== undefined &&
      routeIndex >= firstWindow && routeIndex <= lastWindow;
    return {
      routeIndex,
      point,
      state,
      slot,
      badge: slot === null ? null : state === "queued" ? "outline" : "filled",
      position: formatPosition(point.latitude, point.longitude),
      pageStart: pageStarts.get(routeIndex) ?? null,
      insideWindowRail,
      railStart: routeIndex === firstWindow,
      railEnd: routeIndex === lastWindow,
      canSave: state === "pending" && routeIndex === earliest,
      canPass: state === "saved",
      canSkip: state === "pending" || state === "queued",
    };
  });
  return { rows, pageCount: pages.length, windowVisible: window.length > 0,
    procedureControlsLocked: areProcedureControlsLocked(snapshot) };
}

const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Render a persisted ISO instant in UTC aviation style, never browser-local time. */
export function formatUtcAviation(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid tracker timestamp");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = date.getUTCFullYear();
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${months[date.getUTCMonth()]} ${year} ${hour}${minute}Z`;
}

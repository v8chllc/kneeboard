/**
 * Page construction: display grouping over the complete navlog.
 *
 * Pages are consecutive groups of nine eligible slot assignments, not a fixed
 * number of displayed rows. Points that hold no slot still appear, on the page
 * the rules below place them.
 *
 * Governed by `docs/tracker-behavior.md` §Page construction:
 *
 * 1. Page 1 begins at the start of the navlog and includes the excluded origin
 *    and every other excluded point before the fix assigned to slot 1.
 * 2. A normal page includes the eligible fixes assigned slots 1 through 9.
 * 3. Excluded points between a page's slot 9 and the next page's slot 1 are
 *    appended to the page ending at slot 9, never prepended to the next page.
 * 4. The next page begins exactly with its slot 1 fix.
 * 5. The last page includes every excluded point after the final slot-assigned
 *    fix.
 * 6. Skips and pre-start SID/STAR exclusions rebuild page membership while
 *    preserving original navlog order.
 */

import type { Navlog } from "./navlog";
import type { Page } from "./pages";
import type { SlotAssignment } from "./slots";

/**
 * Groups every navlog point into pages.
 *
 * A new page starts only at a fix assigned slot 1, and only once the current
 * page already holds a slot-assigned fix. Everything else — the origin,
 * airports, computed points, skipped fixes, and procedure-excluded fixes —
 * accumulates into whichever page is open when it is reached, which is what
 * makes rules 1, 3, and 5 a single behavior rather than three special cases.
 */
export function buildPages(
  navlog: Navlog,
  assignments: readonly SlotAssignment[],
): readonly Page[] {
  const slotByRoute = new Map(
    assignments.map((assignment) => [assignment.routeIndex, assignment.slot]),
  );

  const pages: Page[] = [];
  let current: number[] = [];
  let currentHoldsSlot = false;

  for (const point of navlog.points) {
    const slot = slotByRoute.get(point.routeIndex);

    if (slot === 1 && currentHoldsSlot) {
      pages.push({ pageNumber: pages.length + 1, routeIndexes: current });
      current = [];
      currentHoldsSlot = false;
    }

    current.push(point.routeIndex);
    if (slot !== undefined) {
      currentHoldsSlot = true;
    }
  }

  if (current.length > 0) {
    pages.push({ pageNumber: pages.length + 1, routeIndexes: current });
  }

  return pages;
}

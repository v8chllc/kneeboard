/**
 * Pages: display grouping over the complete navlog.
 *
 * A page is a consecutive group of nine eligible slot assignments, not a fixed
 * number of displayed rows. Excluded points appear on the appropriate page
 * without consuming slots, and excluded points between a page's slot 9 and the
 * next page's slot 1 belong to the preceding page.
 *
 * Pages are display grouping only. They are not the sliding window, and there
 * is no "active page".
 *
 * Governed by `docs/tracker-behavior.md` §Page construction.
 */

export interface Page {
  /** One-based page number in route order. */
  readonly pageNumber: number;
  /**
   * Route indexes of every point displayed on this page, in original route
   * order, including points that hold no slot.
   */
  readonly routeIndexes: readonly number[];
}

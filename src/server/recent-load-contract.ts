/** Metadata shown for one successful load; timestamps are UTC ISO instants. */
export interface RecentLoadItem {
  readonly trackerId: string;
  readonly flightNumber: string;
  readonly originIcaoCode: string;
  readonly destinationIcaoCode: string;
  readonly generatedAtUtc: string;
  readonly loadedAtUtc: string;
}

/** A failed metadata read is distinct from a successful empty history. */
export type RecentLoadsResult =
  | { readonly status: "ready"; readonly loads: readonly RecentLoadItem[] }
  | { readonly status: "unavailable" };

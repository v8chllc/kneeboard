/**
 * The immutable normalized navlog: the domain's interpretation of the OFP's
 * primary origin-to-destination route.
 *
 * Every point in the navlog is displayed in original route order, including
 * points that can never receive an INS slot. Classification is fixed at
 * construction; eligibility depends additionally on the tracker's SID/STAR
 * inclusion state and is therefore derived, not stored here.
 *
 * Governed by `docs/tracker-behavior.md` §Route scope, §Displayed data, and
 * §Slot eligibility.
 */

/**
 * The SimBrief `type` tokens observed in accepted captures. An input token
 * outside this set is not an error: it classifies as
 * {@link NavlogPointClassification} `"unrecognized"` and is ineligible.
 */
export const KNOWN_SOURCE_TYPES = ["wpt", "vor", "ltlg", "apt"] as const;

/** A recognized SimBrief `type` token. */
export type KnownSourceType = (typeof KNOWN_SOURCE_TYPES)[number];

/**
 * The outcome of the fail-closed classification order in
 * `docs/tracker-behavior.md` §Slot eligibility.
 *
 * - `airport` — source type `apt`; never eligible.
 * - `coordinateFix` — `ltlg` whose ident matches `^\d{2}[NS]\d{3}[EW]$`;
 *   eligible.
 * - `computedPoint` — any other `ltlg`, such as top of climb or top of descent;
 *   never eligible.
 * - `sidFix` / `starFix` — flagged `wpt` or `vor` whose inbound `via_airway`
 *   exactly matches the OFP's dedicated `sid_ident` or `star_ident`; eligible
 *   unless the corresponding procedure is excluded before first Save.
 * - `ambiguousProcedureFix` — flagged `wpt` or `vor` matching neither dedicated
 *   identifier; ineligible rather than guessed.
 * - `enrouteFix` — any remaining `wpt` or `vor`; eligible.
 * - `unrecognized` — unrecognized source type; ineligible.
 */
export type NavlogPointClassification =
  | "airport"
  | "coordinateFix"
  | "computedPoint"
  | "sidFix"
  | "starFix"
  | "ambiguousProcedureFix"
  | "enrouteFix"
  | "unrecognized";

/**
 * One displayed row of the navlog, including the synthesized origin row.
 *
 * `routeIndex` is assigned once, in original route order, and is the stable
 * identity every command and derived view refers to. It is not a slot number
 * and never changes; Skip and the SID/STAR controls renumber slots, never route
 * indexes.
 */
export interface NavlogPoint {
  /** Zero-based position in {@link Navlog.points}, in original route order. */
  readonly routeIndex: number;
  readonly ident: string;
  /** The untrusted SimBrief `type` token this point was classified from. */
  readonly sourceType: string;
  readonly classification: NavlogPointClassification;
  /** Signed decimal degrees in `[-90, 90]`. Negative is south. */
  readonly latitude: number;
  /** Signed decimal degrees in `[-180, 180]`. Negative is west. */
  readonly longitude: number;
  /**
   * `DIS`: nautical miles of the leg from the preceding point into this one.
   * `null` only on the synthesized origin row, which no leg precedes.
   */
  readonly dis: number | null;
  /**
   * `RDIS`: nautical miles remaining to the destination, derived by summing the
   * leg distances of every later row. Zero at the destination by construction.
   * The OFP's great-circle air distance must never be used.
   */
  readonly rdis: number;
  /**
   * True only for the leading display-only origin row the domain synthesizes
   * from the OFP's separate origin data. The OFP navlog itself omits the
   * origin, because each row describes the leg preceding it.
   */
  readonly isSynthesizedOrigin: boolean;
}

/** OFP identity retained alongside the route for display and cross-checks. */
export interface NavlogMetadata {
  /** SimBrief `params.time_generated` as Unix seconds. Displayed in UTC. */
  readonly generatedAtUnixSeconds: number;
  /** Displayed as supplied, including SimBrief's registration substitution. */
  readonly flightNumber: string;
  readonly originIcaoCode: string;
  readonly destinationIcaoCode: string;
  /** Empty when the OFP declares no SID. */
  readonly sidIdent: string;
  /** Empty when the OFP declares no STAR. */
  readonly starIdent: string;
}

/**
 * The complete immutable route. Persisted once per tracker and never mutated by
 * a command; all mutable state lives in the tracker snapshot.
 */
export interface Navlog {
  readonly metadata: NavlogMetadata;
  /** Every point in original route order, index 0 being the origin row. */
  readonly points: readonly NavlogPoint[];
}

import "server-only";

import { z } from "zod";
import type { OfpInput } from "../domain/ofp-input";
import { parseSimbriefOrigin } from "./simbrief-config";

export const SIMBRIEF_TIMEOUT_MS = 20_000;
export const SIMBRIEF_MAX_BYTES = 8 * 1024 * 1024;

const numeric = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)])
  .transform(Number).pipe(z.number().finite());
const nonNegativeDistance = numeric.pipe(z.number().nonnegative());
const unixSeconds = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform(Number).pipe(z.number().int().nonnegative());
const latitude = numeric.pipe(z.number().min(-90).max(90));
const longitude = numeric.pipe(z.number().min(-180).max(180));
const flag = z.union([z.literal(0), z.literal(1), z.literal("0"), z.literal("1")])
  .transform((value) => value === 1 || value === "1");
const airport = z.object({
  icao_code: z.string(),
  pos_lat: latitude,
  pos_long: longitude,
}).transform((value) => ({
  icaoCode: value.icao_code,
  latitude: value.pos_lat,
  longitude: value.pos_long,
}));
const fix = z.object({
  ident: z.string(),
  type: z.string(),
  is_sid_star: flag,
  via_airway: z.string(),
  pos_lat: latitude,
  pos_long: longitude,
  distance: nonNegativeDistance,
}).transform((value) => ({
  ident: value.ident,
  sourceType: value.type,
  isSidStar: value.is_sid_star,
  viaAirway: value.via_airway,
  latitude: value.pos_lat,
  longitude: value.pos_long,
  distance: value.distance,
}));
const detailedFixes = z.preprocess(
  (value) => value && typeof value === "object" && !Array.isArray(value) ? [value] : value,
  z.array(fix).nonempty(),
);
const ofpSchema = z.object({
  params: z.object({ time_generated: unixSeconds }),
  general: z.object({
    flight_number: z.string().min(1),
    sid_ident: z.string(),
    star_ident: z.string(),
    route_distance: nonNegativeDistance,
  }),
  origin: airport,
  destination: airport,
  navlog: z.object({ fix: detailedFixes }),
}).transform((value): OfpInput => ({
  generatedAtUnixSeconds: value.params.time_generated,
  flightNumber: value.general.flight_number,
  origin: value.origin,
  destination: value.destination,
  sidIdent: value.general.sid_ident,
  starIdent: value.general.star_ident,
  routeDistance: value.general.route_distance,
  fixes: value.navlog.fix,
}));

export type SimbriefOfpFailure = "nonLido" | "missingNavlog" | "invalidOfp" | "upstream";

/** No error text contains response data; paths identify only expected fields. */
export class SimbriefOfpError extends Error {
  constructor(readonly reason: SimbriefOfpFailure, readonly paths: readonly string[] = []) {
    super(`SimBrief ${reason}${paths.length ? `: ${paths.join(", ")}` : ""}`);
    this.name = "SimbriefOfpError";
  }
}

/** Validate representation only. Domain route interpretation follows this boundary. */
export function parseSimbriefOfp(rawPayload: unknown): OfpInput {
  const layout = z.object({ params: z.object({ ofp_layout: z.string() }) }).safeParse(rawPayload);
  if (!layout.success) throw new SimbriefOfpError("invalidOfp", ["params.ofp_layout"]);
  if (layout.data.params.ofp_layout !== "LIDO") throw new SimbriefOfpError("nonLido", ["params.ofp_layout"]);
  const result = ofpSchema.safeParse(rawPayload);
  if (!result.success) {
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    const missingNavlog = paths.some((path) => path === "navlog" || path === "navlog.fix");
    throw new SimbriefOfpError(missingNavlog ? "missingNavlog" : "invalidOfp", paths);
  }
  return result.data;
}

export interface FetchedSimbriefOfp {
  readonly rawPayload: unknown;
  readonly ofpInput: OfpInput;
}

/** Fetch the latest JSON OFP once, with redirect, timeout, and streamed byte limits. */
export async function fetchSimbriefOfp(
  pilotId: string,
  options: { origin?: string; fetchImpl?: typeof fetch } = {},
): Promise<FetchedSimbriefOfp> {
  if (!/^\d{1,16}$/.test(pilotId)) throw new SimbriefOfpError("upstream");
  const origin = options.origin === undefined
    ? parseSimbriefOrigin(process.env)
    : parseSimbriefOrigin({ NODE_ENV: process.env.NODE_ENV, SIMBRIEF_BASE_URL: options.origin });
  const url = new URL("/api/xml.fetcher.php", origin);
  url.searchParams.set("userid", pilotId);
  url.searchParams.set("json", "1");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SIMBRIEF_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok || response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new SimbriefOfpError("upstream");
    }
    if (!response.body) throw new SimbriefOfpError("upstream");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > SIMBRIEF_MAX_BYTES) throw new SimbriefOfpError("upstream");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let rawPayload: unknown;
    try { rawPayload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new SimbriefOfpError("upstream"); }
    return { rawPayload, ofpInput: parseSimbriefOfp(rawPayload) };
  } catch (error) {
    if (error instanceof SimbriefOfpError) throw error;
    throw new SimbriefOfpError("upstream");
  } finally {
    clearTimeout(timeout);
    if (reader) await reader.cancel().catch(() => undefined);
  }
}

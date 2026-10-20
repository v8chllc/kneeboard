import "server-only";

import { z } from "zod";

const originSchema = z.url().refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
}, "Expected an origin without credentials, path, query, or fragment");

/** Validate the SimBrief origin before any request can leave the server. */
export function parseSimbriefOrigin(environment: Record<string, string | undefined>): string {
  const mode = z.enum(["development", "test", "production"]).safeParse(environment.NODE_ENV ?? "development");
  const origin = originSchema.safeParse(environment.SIMBRIEF_BASE_URL);
  if (!mode.success || !origin.success) throw new Error("Invalid SimBrief configuration");
  const url = new URL(origin.data);
  if (mode.data === "production") {
    if (origin.data !== "https://www.simbrief.com") throw new Error("Invalid SimBrief configuration");
  } else if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Invalid SimBrief configuration");
  }
  return url.origin;
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadOfpFixture } from "../../tests/support/ofp-fixture-adapter";
import { parseSimbriefOrigin } from "./simbrief-config";
import {
  fetchSimbriefOfp, parseSimbriefOfp, SimbriefOfpError, SIMBRIEF_MAX_BYTES,
} from "./simbrief-ofp";

vi.mock("server-only", () => ({}));

const fixtures = path.join(process.cwd(), "tests/fixtures/simbrief");
const valid = [
  "valid-domestic.json", "valid-multi-page.json", "valid-oceanic.json",
  "valid-southern-eastern.json", "valid-sparse-identity.json",
  "valid-exactly-nine.json", "valid-ten-boundary-cases.json",
];
const invalid = [
  "invalid-missing-detailed-navlog.json", "invalid-non-lido.json",
  "invalid-malformed-numeric-values.json", "invalid-empty-sections.json",
  "invalid-missing-required-fields.json", "invalid-null-flight-number.json",
  "invalid-empty-flight-number.json",
];
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixtures, name), "utf8"));
}
function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}
function expectedFailure(value: unknown): SimbriefOfpError {
  try { parseSimbriefOfp(value); } catch (error) {
    expect(error).toBeInstanceOf(SimbriefOfpError);
    return error as SimbriefOfpError;
  }
  throw new Error("Expected rejection");
}

describe("SimBrief configuration", () => {
  it("marks configuration and OFP capabilities as server-only", () => {
    for (const name of ["simbrief-config.ts", "simbrief-ofp.ts"]) {
      expect(readFileSync(path.join(process.cwd(), "src/server", name), "utf8"))
        .toMatch(/^import "server-only";/);
    }
  });
  it("requires the exact production origin and an explicit local loopback origin", () => {
    expect(parseSimbriefOrigin({ NODE_ENV: "production", SIMBRIEF_BASE_URL: "https://www.simbrief.com" })).toBe("https://www.simbrief.com");
    for (const value of [undefined, "https://simbrief.com", "http://www.simbrief.com", "https://www.simbrief.com/", "https://www.simbrief.com:443", "https://www.simbrief.com/path", "https://www.simbrief.com/?q=1"]) {
      expect(() => parseSimbriefOrigin({ NODE_ENV: "production", SIMBRIEF_BASE_URL: value })).toThrow("Invalid SimBrief configuration");
    }
    for (const value of [undefined, "https://www.simbrief.com", "https://127.0.0.1:8765", "http://simbrief.test", "http://127.0.0.2:8765", "http://127.0.0.1:8765/path", "http://user@127.0.0.1:8765"]) {
      expect(() => parseSimbriefOrigin({ NODE_ENV: "test", SIMBRIEF_BASE_URL: value })).toThrow("Invalid SimBrief configuration");
    }
    expect(parseSimbriefOrigin({ NODE_ENV: "test", SIMBRIEF_BASE_URL: "http://127.0.0.1:8765" })).toBe("http://127.0.0.1:8765");
  });
});

describe("SimBrief representation boundary", () => {
  it.each(valid)("matches the domain fixture adapter for %s", (name) => {
    expect(parseSimbriefOfp(fixture(name))).toEqual(loadOfpFixture(name));
  });
  it.each(invalid)("rejects %s with safe paths", (name) => {
    const error = expectedFailure(fixture(name));
    expect(error.paths.length).toBeGreaterThan(0);
    expect(error.message).not.toContain("TST");
    if (name === "invalid-non-lido.json") {
      expect(error.reason).toBe("nonLido");
      expect(error.paths).toEqual(["params.ofp_layout"]);
    }
    if (name === "invalid-missing-detailed-navlog.json") expect(error.reason).toBe("missingNavlog");
  });
  it("normalizes one fix and rejects invalid flag, coordinate, and missing layout", () => {
    const base = fixture("valid-domestic.json") as Record<string, unknown>;
    const navlog = base.navlog as { fix: Record<string, unknown>[] };
    const one = { ...base, navlog: { fix: navlog.fix[0] } };
    expect(parseSimbriefOfp(one).fixes).toHaveLength(1);
    for (const change of [{ is_sid_star: "true" }, { pos_lat: "91" }, { distance: "not-a-number" }]) {
      const error = expectedFailure({ ...base, navlog: { fix: [{ ...navlog.fix[0], ...change }] } });
      expect(error.reason).toBe("invalidOfp");
    }
    expect(expectedFailure({ ...base, params: {} }).paths).toEqual(["params.ofp_layout"]);
  });
  it("rejects negative distances and non-integer Unix seconds", () => {
    const base = fixture("valid-domestic.json") as Record<string, unknown>;
    const navlog = base.navlog as { fix: Record<string, unknown>[] };
    const general = base.general as Record<string, unknown>;
    const params = base.params as Record<string, unknown>;
    for (const payload of [
      { ...base, navlog: { fix: [{ ...navlog.fix[0], distance: "-1" }] } },
      { ...base, general: { ...general, route_distance: -1 } },
      { ...base, params: { ...params, time_generated: "-1" } },
      { ...base, params: { ...params, time_generated: "1.5" } },
      { ...base, params: { ...params, time_generated: 1.5 } },
    ]) {
      expect(expectedFailure(payload).reason).toBe("invalidOfp");
    }
  });
});

describe("SimBrief fetch client", () => {
  const origin = "http://127.0.0.1:8765";
  it("cannot use the test origin override to bypass production configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const fetchImpl = vi.fn();
      await expect(fetchSimbriefOfp("123", { origin, fetchImpl }))
        .rejects.toThrow("Invalid SimBrief configuration");
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
  it("requests the configured fetcher once with Pilot ID, JSON, no cache and no redirects", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(fixture("valid-domestic.json")));
    const result = await fetchSimbriefOfp("000123", { origin, fetchImpl });
    expect(result.ofpInput).toEqual(loadOfpFixture("valid-domestic.json"));
    expect(result.rawPayload).toEqual(fixture("valid-domestic.json"));
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/xml.fetcher.php");
    expect(url.search).toBe("?userid=000123&json=1");
    expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
  });
  it("rejects non-success, wrong content type, malformed JSON, and oversize streams", async () => {
    const responses = [
      new Response("error", { status: 400 }),
      new Response("{}", { headers: { "content-type": "text/html" } }),
      new Response(JSON.stringify(fixture("valid-domestic.json")), { headers: { "content-type": "application/json-junk" } }),
      new Response("{", { headers: { "content-type": "application/json" } }),
      new Response(`${JSON.stringify(fixture("valid-domestic.json"))}${" ".repeat(SIMBRIEF_MAX_BYTES)}`, { headers: { "content-type": "application/json", "content-length": "1" } }),
    ];
    for (const response of responses) {
      await expect(fetchSimbriefOfp("123", { origin, fetchImpl: async () => response }))
        .rejects.toMatchObject({ reason: "upstream" });
    }
  });
  it("aborts a stalled transport within the configured time", async () => {
    vi.useFakeTimers();
    try {
      const request = fetchSimbriefOfp("123", {
        origin,
        fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      });
      const assertion = expect(request).rejects.toMatchObject({ reason: "upstream" });
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;
    } finally { vi.useRealTimers(); }
  });
});

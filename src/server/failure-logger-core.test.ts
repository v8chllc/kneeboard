import { describe, expect, it } from "vitest";

import type { FailureLogInput } from "./logging-contract";
import { createFailureLogger } from "./failure-logger-core";

const fixedTime = new Date("2026-10-24T19:00:00.000Z");
const idA = "e3295a0b-8aa5-44d6-aa90-d2b5a4f3a111";
const idB = "e3295a0b-8aa5-44d6-aa90-d2b5a4f3a112";

describe("allowlisted failure logger", () => {
  it("emits one exact JSON record per failure with fixed event/code pairs", () => {
    const lines: string[] = [];
    const ids = [idA, idB];
    const log = createFailureLogger((line) => lines.push(line), () => fixedTime, () => ids.shift()!);
    const sensitive = "private-pilot-000123 email@example.invalid session-token magic-link /trackers/private 42.123N raw-OFP upstream-secret";
    log({ severity: "error", event: "ofp_fetch_failure", errorCode: "OFP_FETCH_FAILED",
      error: new Error(sensitive), request: { body: sensitive }, accountId: sensitive,
    } as FailureLogInput);
    log({ severity: "warning", event: "stale_version_conflict", errorCode: "STALE_VERSION" });
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({
      timestamp: "2026-10-24T19:00:00.000Z", severity: "error",
      event: "ofp_fetch_failure", correlationId: idA, errorCode: "OFP_FETCH_FAILED",
    });
    expect(JSON.parse(lines[1])).toEqual({
      timestamp: "2026-10-24T19:00:00.000Z", severity: "warning",
      event: "stale_version_conflict", correlationId: idB, errorCode: "STALE_VERSION",
    });
    expect(Object.keys(JSON.parse(lines[0]))).toEqual(["timestamp", "severity", "event", "correlationId", "errorCode"]);
    expect(lines.join("\n")).not.toContain(sensitive);
    for (const fragment of ["email@example.invalid", "session-token", "magic-link", "42.123N", "raw-OFP", "upstream-secret"]) {
      expect(lines.join("\n")).not.toContain(fragment);
    }
  });

  it("generates independent random UUIDs and ignores a forged runtime code or event", () => {
    const lines: string[] = [];
    const log = createFailureLogger((line) => lines.push(line));
    log({ severity: "error", event: "authentication_delivery_failure", errorCode: "FORGED", secret: "private" } as unknown as FailureLogInput);
    log({ severity: "error", event: "authentication_delivery_failure", errorCode: "AUTH_DELIVERY_FAILED" });
    log({ severity: "error", event: "private-event", errorCode: "PRIVATE" } as unknown as FailureLogInput);
    expect(lines).toHaveLength(2);
    const records = lines.map((line) => JSON.parse(line) as { correlationId: string; errorCode: string });
    expect(records.map((record) => record.errorCode)).toEqual(["AUTH_DELIVERY_FAILED", "AUTH_DELIVERY_FAILED"]);
    expect(records[0].correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(records[1].correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(records[0].correlationId).not.toBe(records[1].correlationId);
    expect(lines.join("\n")).not.toContain("private");
  });

  it("does not change the caller's failure result when output is unavailable", () => {
    const log = createFailureLogger(() => { throw new Error("output unavailable"); });
    expect(() => log({ severity: "error", event: "unexpected_server_error", errorCode: "UNEXPECTED_SERVER_ERROR" }))
      .not.toThrow();
  });
});

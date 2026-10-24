import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RecentLoadsResult } from "../server/recent-load-contract";
import { createRecentLoadOperation } from "../server/recent-load-operations";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { RecentLoads } from "./recent-loads";

function render(result: RecentLoadsResult) {
  return renderToStaticMarkup(<RecentLoads result={result} />);
}

describe("recent loads home states", () => {
  it("shows empty history separately from a failed read with a refresh retry", async () => {
    const empty = await createRecentLoadOperation(async () => [])("account-a");
    const failure = await createRecentLoadOperation(async () => { throw new Error("private upstream sentinel"); })("account-a");
    expect(empty).toEqual({ status: "ready", loads: [] });
    expect(failure).toEqual({ status: "unavailable" });
    const emptyMarkup = render(empty);
    const failureMarkup = render(failure);
    expect(emptyMarkup).toContain("No OFPs loaded yet");
    expect(emptyMarkup).not.toContain("Retry recent loads");
    expect(failureMarkup).toContain('role="alert"');
    expect(failureMarkup).toContain("Recent loads could not be shown. Try again.");
    expect(failureMarkup).toContain("Retry recent loads");
    expect(failureMarkup).not.toContain("No OFPs loaded yet");
    expect(failureMarkup).not.toContain("private upstream sentinel");
  });

  it("shows distinct tracker links and aviation UTC metadata for matching flights", () => {
    const result: RecentLoadsResult = { status: "ready", loads: [
      { trackerId: "first-id", flightNumber: "SAME123", originIcaoCode: "KLAX", destinationIcaoCode: "KJFK",
        generatedAtUtc: "2026-10-20T09:00:00.000Z", loadedAtUtc: "2026-10-20T10:00:00.000Z" },
      { trackerId: "second-id", flightNumber: "SAME123", originIcaoCode: "KLAX", destinationIcaoCode: "KJFK",
        generatedAtUtc: "2026-10-20T09:00:00.000Z", loadedAtUtc: "2026-10-20T10:01:00.000Z" },
    ] };
    const markup = render(result);
    expect(markup.match(/SAME123/g)).toHaveLength(2);
    expect(markup).toContain('href="/trackers/first-id"');
    expect(markup).toContain('href="/trackers/second-id"');
    expect(markup).toContain("KLAX → KJFK");
    expect(markup).toContain("Loaded 20 OCT 2026 1000Z");
    expect(markup).toContain("Loaded 20 OCT 2026 1001Z");
    expect(markup).toContain("OFP generated 20 OCT 2026 0900Z");
  });
});

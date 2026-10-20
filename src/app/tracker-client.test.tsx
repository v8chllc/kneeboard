import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createInitialSnapshot } from "../domain";
import { navlogFor } from "../../tests/support/tracker-scenarios";

import { TrackerClient } from "./tracker-client";

vi.mock("./tracker-actions", () => ({ mutateTrackerAction: vi.fn() }));

const navlog = navlogFor("valid-domestic.json");
const initial = {
  status: "found" as const,
  navlog,
  snapshot: createInitialSnapshot(navlog),
  header: {
    flightNumber: "TEST42",
    originIcaoCode: "KORD",
    destinationIcaoCode: "KJFK",
    generatedAtUtc: "2026-10-20T00:15:00.000Z",
    loadedAtUtc: "2026-10-20T00:20:00.000Z",
  },
};

describe("tracker page markup", () => {
  it("shows a complete route with UTC header, simulation warning and explicit pass behavior", () => {
    const html = renderToStaticMarkup(<TrackerClient trackerId="tracker" initial={initial} />);
    expect(html).toContain("TEST42");
    expect(html).toContain("KORD → KJFK");
    expect(html).toContain("20 OCT 2026 0015Z");
    expect(html).toContain("For home flight simulation only");
    expect(html).toContain("Passing a later saved fix also passes every earlier saved fix");
    expect((html.match(/class="tracker-row"/g) ?? [])).toHaveLength(navlog.points.length);
  });

  it("keeps ineligible rows readable without an entry keypad or action", () => {
    const html = renderToStaticMarkup(<TrackerClient trackerId="tracker" initial={initial} />);
    const origin = html.match(/<li class="tracker-row" data-state="ineligible"[\s\S]*?<\/li>/)?.[0];
    expect(origin).toBeDefined();
    expect(origin).toContain("Not slot-eligible");
    expect(origin).toContain("tracker-lido");
    expect(origin).not.toContain("tracker-keypad");
    expect(origin).not.toContain("tracker-row-actions");
    expect(html).toContain("SID included");
    expect(html).toContain("STAR included");
  });
});

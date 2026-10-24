import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createInitialSnapshot, deriveEligibleSequenceForSnapshot, formatPosition } from "../domain";
import { applyOrThrow, navlogFor, reachState } from "../../tests/support/tracker-scenarios";

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

  it("renders the six distinct state labels and glyphs with an outlined queued slot", () => {
    const route = navlogFor("valid-multi-page.json");
    const tracker = (snapshot: typeof initial.snapshot) => renderToStaticMarkup(<TrackerClient trackerId="tracker"
      initial={{ ...initial, navlog: route, snapshot }} />);
    const fresh = createInitialSnapshot(route);
    const entered = reachState(route, { entered: 3, passed: 1 });
    const skippedIndex = deriveEligibleSequenceForSnapshot(route, fresh)[0];
    const skipped = applyOrThrow(route, fresh, { type: "skipWaypoint", routeIndex: skippedIndex, expectedVersion: fresh.version });
    const samples = [tracker(fresh), tracker(entered), tracker(skipped)];
    for (const [state, glyph, label] of [
      ["queued", "○", "Queued"], ["pending", "▶", "Pending"],
      ["saved", "✓", "Saved"], ["passed", "↗", "Passed"],
      ["skipped", "×", "Skipped"], ["ineligible", "·", "Not slot-eligible"],
    ]) {
      const row = samples.flatMap((html) => [...html.matchAll(new RegExp(`<li class="tracker-row" data-state="${state}"[\\s\\S]*?<\\/li>`, "g"))]
        .map((match) => match[0]))[0];
      expect(row, `${state} row is present`).toBeDefined();
      expect(row).toContain(`<span class="tracker-state" aria-label="${label}"><span aria-hidden="true">${glyph}</span> ${label}</span>`);
      if (state === "queued") expect(row).toMatch(/class="tracker-slot tracker-slot-outline" aria-label="INS slot [1-9]"/);
    }
  });

  it("shows a skipped row's LIDO position and distances without keypad values", () => {
    const route = navlogFor("valid-multi-page.json");
    const fresh = createInitialSnapshot(route);
    const index = deriveEligibleSequenceForSnapshot(route, fresh)[0];
    const skipped = applyOrThrow(route, fresh, { type: "skipWaypoint", routeIndex: index, expectedVersion: fresh.version });
    const html = renderToStaticMarkup(<TrackerClient trackerId="tracker"
      initial={{ ...initial, navlog: route, snapshot: skipped }} />);
    const row = html.match(/<li class="tracker-row" data-state="skipped"[\s\S]*?<\/li>/)?.[0];
    expect(row).toBeDefined();
    const point = route.points[index];
    const position = formatPosition(point.latitude, point.longitude);
    expect(row).toContain(`<span class="tracker-lido">${position.latitude.lido.replaceAll("'", "&#x27;")} · ${position.longitude.lido.replaceAll("'", "&#x27;")}</span>`);
    expect(row).toContain(`<span class="tracker-distance">DIS ${point.dis ?? "—"} · RDIS ${point.rdis} NM</span>`);
    expect(row).not.toContain("tracker-keypad");
  });

  it("preserves route-index identity when waypoint identifiers repeat", () => {
    const route = navlogFor("valid-ten-boundary-cases.json");
    const repeated = route.points.flatMap((point, index) => point.ident === "REPEAT" ? [index] : []);
    expect(repeated.length).toBeGreaterThan(1);
    const html = renderToStaticMarkup(<TrackerClient trackerId="tracker"
      initial={{ ...initial, navlog: route, snapshot: createInitialSnapshot(route) }} />);
    expect((html.match(/class="tracker-row"/g) ?? [])).toHaveLength(route.points.length);
    expect((html.match(/class="tracker-ident">REPEAT<\/strong>/g) ?? [])).toHaveLength(repeated.length);
  });
});

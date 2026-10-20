import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { logServerEvent } from "./structured-log";

vi.mock("server-only", () => ({}));

describe("structured server logging", () => {
  it("keeps the logger behind a server-only boundary", () => {
    const source = readFileSync(path.join(process.cwd(), "src/server/structured-log.ts"), "utf8");
    expect(source).toMatch(/^import "server-only";/);
  });

  it("writes one structured event to the server console", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const event = {
      operation: "tracker.read" as const,
      correlationId: "a4a420e8-6f34-4411-936a-97ce73364d3f",
      outcome: "failed" as const,
      reason: "unreadable",
    };
    try {
      logServerEvent(event);
      expect(error).toHaveBeenCalledExactlyOnceWith(event);
    } finally {
      error.mockRestore();
    }
  });
});

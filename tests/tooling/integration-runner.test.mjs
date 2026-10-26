import { describe, expect, it } from "vitest";
import { inspectResults, JOURNEY_ONLY_FILES } from "../../scripts/test-integration.mjs";

function report(file, status = "passed") {
  return {
    success: true,
    testResults: [{
      name: `/repo/${file}`,
      startTime: 0,
      endTime: 1000,
      status: "passed",
      assertionResults: [{ status }],
    }],
  };
}

describe("integration test skip gate", () => {
  it("allows only the five isolated Journey files to skip", () => {
    expect([...JOURNEY_ONLY_FILES]).toEqual([
      "src/db/db-journey.test.ts",
      "src/db/recent-loads.integration.test.ts",
      "src/server/auth-integration.test.ts",
      "src/server/account-settings.integration.test.ts",
      "src/server/mail-delivery.integration.test.ts",
    ]);
    for (const file of JOURNEY_ONLY_FILES) {
      expect(inspectResults(report(file, "skipped"), "/repo").errors).toEqual([]);
    }
  });

  it("rejects a skipped test in any other file", () => {
    expect(inspectResults(report("src/db/new-database.test.ts", "skipped"), "/repo").errors)
      .toContain("src/db/new-database.test.ts: 1 unexpected skipped test(s)");
  });
});

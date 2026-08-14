import { expect, test } from "vitest";

test("runs tests in the Node environment", () => {
  expect(process.release.name).toBe("node");
});

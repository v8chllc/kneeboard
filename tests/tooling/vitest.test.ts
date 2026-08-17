import { expect, test } from "vitest";

test("runs tests in the Node environment", () => {
  expect(typeof window).toBe("undefined");
});

import { describe, expect, it } from "vitest";

import { twoRedemptionsWaiting } from "./redemption-barrier";

describe("simultaneous redemption barrier", () => {
  it("requires two distinct waiting backends", () => {
    expect(twoRedemptionsWaiting([])).toBe(false);
    expect(twoRedemptionsWaiting([{ pid: 101 }])).toBe(false);
    expect(twoRedemptionsWaiting([{ pid: 101 }, { pid: 101 }])).toBe(false);
    expect(twoRedemptionsWaiting([{ pid: 101 }, { pid: 102 }])).toBe(true);
  });
});

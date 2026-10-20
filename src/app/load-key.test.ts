import { describe, expect, it } from "vitest";
import { createLoadKeyState } from "./load-key";

describe("load action key lifetime", () => {
  it("retains a key for transport retries and rotates it for a later deliberate load", () => {
    let generated = 0;
    const keys = createLoadKeyState(() => `key-${++generated}`);
    expect(() => keys.retry()).toThrow("No load action to retry");
    expect(keys.newAction()).toBe("key-1");
    expect(keys.retry()).toBe("key-1");
    expect(keys.newAction()).toBe("key-2");
    expect(keys.retry()).toBe("key-2");
    expect(generated).toBe(2);
  });
});

import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { LoadUiResult } from "@/server/ofp-load-operations";

const state = vi.hoisted(() => ({
  result: null as LoadUiResult | null,
  refs: [{ current: null as { newAction(): string; retry(): string } | null }, { current: false }],
  refIndex: 0,
}));
const loadAction = vi.hoisted(() => vi.fn(async (key: string) => {
  if (!key) throw new Error("Expected an action key");
  return { status: "failed" as const, message: "The OFP could not be loaded. Check your plan and try again." };
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: () => [state.result, (next: LoadUiResult | null) => { state.result = next; }],
  useRef: () => state.refs[state.refIndex++],
  useTransition: () => [false, (work: () => void) => work()],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./home-actions", () => ({ loadLatestOfpAction: loadAction }));
vi.mock("./auth-client", () => ({ authClient: {} }));

import { LoadOfpControl } from "./home-forms";

function button(node: ReactNode, label: string): ReactElement<{ onClick: () => void }> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === "button" && child.props.children === label) {
      return child as ReactElement<{ onClick: () => void }>;
    }
    const nested = button(child.props.children, label);
    if (nested) return nested;
  }
}

describe("home OFP load control", () => {
  it("offers Retry after a failed load and submits the original action key", async () => {
    state.result = null;
    state.refs[0].current = null;
    state.refs[1].current = false;
    state.refIndex = 0;
    loadAction.mockClear();
    const first = LoadOfpControl({ ready: true });
    const load = button(first, "Load latest OFP");
    expect(load).toBeDefined();
    load!.props.onClick();
    await vi.waitFor(() => expect(loadAction).toHaveBeenCalledOnce());
    const originalKey = loadAction.mock.calls[0][0];

    state.refIndex = 0;
    const failed = LoadOfpControl({ ready: true });
    const retry = button(failed, "Retry this load");
    expect(retry).toBeDefined();
    retry!.props.onClick();
    await vi.waitFor(() => expect(loadAction).toHaveBeenCalledTimes(2));
    expect(loadAction.mock.calls.map(([key]) => key)).toEqual([originalKey, originalKey]);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createLoadOperation, type LoadUiResult } from "../server/ofp-load-operations";
import { createLoadOfpController } from "./load-control";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./home-actions", () => ({ loadLatestOfpAction: vi.fn() }));
vi.mock("./auth-client", () => ({ authClient: {} }));

import { LoadOfpControlView } from "./home-forms";

function render(snapshot: { pending: boolean; result: LoadUiResult | null }) {
  return renderToStaticMarkup(<LoadOfpControlView ready pending={snapshot.pending}
    result={snapshot.result} onLoad={() => {}} onRetry={() => {}} />);
}

describe("home OFP load control", () => {
  it("shows Retry after a failed load and submits the original action key", async () => {
    let finishFirst!: (result: LoadUiResult) => void;
    const firstResult = new Promise<LoadUiResult>((resolve) => { finishFirst = resolve; });
    const failure: LoadUiResult = { status: "failed", message: "The OFP could not be loaded. Check your plan and try again." };
    const load = vi.fn().mockReturnValueOnce(firstResult).mockResolvedValueOnce(failure);
    const controller = createLoadOfpController(load, vi.fn(), () => crypto.randomUUID());
    const snapshots: ReturnType<typeof controller.getSnapshot>[] = [];
    const unsubscribe = controller.subscribe(() => snapshots.push(controller.getSnapshot()));

    expect(render(controller.getSnapshot())).not.toContain("Retry this load");
    const first = controller.submit(false);
    expect(render(controller.getSnapshot())).toContain("Loading…");
    expect(load).toHaveBeenCalledOnce();
    const originalKey = load.mock.calls[0][0];
    finishFirst(failure);
    await first;
    expect(snapshots.map(({ pending }) => pending)).toEqual([true, true, false]);
    expect(render(controller.getSnapshot())).toContain("Retry this load");
    expect(render(controller.getSnapshot())).toContain('role="alert"');

    await controller.submit(true);
    expect(load.mock.calls.map(([key]) => key)).toEqual([originalKey, originalKey]);
    unsubscribe();
  });

  it("shows the remaining cooldown wait without fetching", async () => {
    const fetch = vi.fn();
    const operation = createLoadOperation({
      resolveAccountId: async () => "account-a",
      readPilotId: async () => "000123",
      load: async () => ({ outcome: "wait", remainingMs: 11_200 }),
      fetch,
    });
    const controller = createLoadOfpController((key) => operation(new Headers(), key), vi.fn(), () => crypto.randomUUID());

    await controller.submit(false);
    const markup = render(controller.getSnapshot());
    expect(markup).toContain("Wait 12 seconds before another load.");
    expect(markup).toContain('role="status"');
    expect(fetch).not.toHaveBeenCalled();
  });
});

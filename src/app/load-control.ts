import type { LoadUiResult } from "@/server/ofp-load-operations";
import { createLoadKeyState } from "./load-key";

export type LoadControlSnapshot = { pending: boolean; result: LoadUiResult | null };

/** Owns the load result and action key across a failed request and its retry. */
export function createLoadOfpController(
  load: (key: string) => Promise<LoadUiResult>,
  navigate: (trackerId: string) => void,
  generateKey: () => string,
) {
  const keys = createLoadKeyState(generateKey);
  const listeners = new Set<() => void>();
  let snapshot: LoadControlSnapshot = { pending: false, result: null };

  function update(next: LoadControlSnapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async submit(retry: boolean) {
      if (snapshot.pending) return;
      const key = retry ? keys.retry() : keys.newAction();
      update({ pending: true, result: null });
      try {
        const result = await load(key);
        update({ pending: true, result });
        if (result.status === "created" || result.status === "completed") {
          navigate(result.trackerId);
        }
      } catch {
        update({ pending: true, result: { status: "failed", message: "The OFP could not be loaded. Check your plan and try again." } });
      } finally {
        update({ pending: false, result: snapshot.result });
      }
    },
  };
}

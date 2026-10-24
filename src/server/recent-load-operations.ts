import type { RecentLoadsResult } from "./recent-load-contract";
import type { RecentLoadItem } from "./recent-load-contract";

/** Keep a failed account-scoped read distinct from a successful empty list. */
export function createRecentLoadOperation(
  read: (accountId: string) => Promise<readonly RecentLoadItem[]>,
) {
  return async (accountId: string): Promise<RecentLoadsResult> => {
    try {
      return { status: "ready", loads: await read(accountId) };
    } catch {
      return { status: "unavailable" };
    }
  };
}

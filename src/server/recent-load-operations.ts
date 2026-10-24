import type { RecentLoadsResult } from "./recent-load-contract";
import type { RecentLoadItem } from "./recent-load-contract";
import type { FailureLogger } from "./failure-logger-core";

/** Keep a failed account-scoped read distinct from a successful empty list. */
export function createRecentLoadOperation(
  read: (accountId: string) => Promise<readonly RecentLoadItem[]>,
  logFailure?: FailureLogger,
) {
  return async (accountId: string): Promise<RecentLoadsResult> => {
    try {
      return { status: "ready", loads: await read(accountId) };
    } catch {
      logFailure?.({ severity: "error", event: "unexpected_server_error", errorCode: "UNEXPECTED_SERVER_ERROR" });
      return { status: "unavailable" };
    }
  };
}

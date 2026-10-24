import "server-only";

import { selectRecentLoadsForAccount } from "../db/recent-loads";
import { getDatabase } from "./database";
import { logFailure } from "./failure-logger";
import { createRecentLoadOperation } from "./recent-load-operations";

/** The caller supplies only a verified session account ID, never browser data. */
export const getRecentLoadsForAccount = createRecentLoadOperation((accountId) =>
  selectRecentLoadsForAccount(getDatabase(), accountId), logFailure);

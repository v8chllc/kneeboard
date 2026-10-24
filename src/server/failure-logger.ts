import "server-only";

import { createFailureLogger } from "./failure-logger-core";

/** One JSON line on standard server output for each handled failure. */
export const logFailure = createFailureLogger((line) => console.log(line));

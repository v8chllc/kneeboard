import { randomUUID } from "node:crypto";

import { failureLogCodes, type FailureLogInput, type FailureLogRecord } from "./logging-contract";

export type FailureLogger = (input: FailureLogInput) => void;

/** Build one fixed-shape record; caller objects and errors never reach the sink. */
export function createFailureLogger(
  sink: (line: string) => void,
  now: () => Date = () => new Date(),
  newId: () => string = randomUUID,
): FailureLogger {
  return (input) => {
    // Logging must not turn an already-handled failure into a new failure.
    try {
      const errorCode = failureLogCodes[input.event];
      if (
        errorCode === undefined
        || input.errorCode !== errorCode
        || (input.severity !== "warning" && input.severity !== "error")
      ) return;
      const record = {
        timestamp: now().toISOString(),
        severity: input.severity,
        event: input.event,
        correlationId: newId(),
        errorCode,
      } as FailureLogRecord;
      sink(JSON.stringify(record));
    } catch { /* Standard output unavailable. */ }
  };
}

export interface ServerLogEvent {
  readonly operation: "ofp.load" | "tracker.read" | "tracker.command";
  readonly correlationId: string;
  readonly outcome: "failed" | "rejected" | "stale";
  readonly reason: string;
}

export type StructuredLogger = (event: ServerLogEvent) => void;

/** Write privacy-safe operational metadata to the server log. */
export const logServerEvent: StructuredLogger = (event) => {
  console.error(event);
};

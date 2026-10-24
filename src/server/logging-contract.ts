/** The only event and error-code pairs accepted by the server failure logger. */
export const failureLogCodes = {
  authentication_delivery_failure: "AUTH_DELIVERY_FAILED",
  ofp_fetch_failure: "OFP_FETCH_FAILED",
  ofp_validation_failure: "OFP_VALIDATION_FAILED",
  tracker_command_failure: "TRACKER_COMMAND_FAILED",
  stale_version_conflict: "STALE_VERSION",
  unexpected_server_error: "UNEXPECTED_SERVER_ERROR",
} as const;

export type FailureLogEvent = keyof typeof failureLogCodes;
export type FailureLogErrorCode = (typeof failureLogCodes)[FailureLogEvent];
export type FailureLogSeverity = "warning" | "error";

export type FailureLogInput = {
  readonly [Event in FailureLogEvent]: {
    readonly severity: FailureLogSeverity;
    readonly event: Event;
    readonly errorCode: (typeof failureLogCodes)[Event];
  };
}[FailureLogEvent];

/** One allowlisted JSON record; the logger supplies time and random UUID. */
export type FailureLogRecord = FailureLogInput & {
  readonly timestamp: string;
  readonly correlationId: string;
};

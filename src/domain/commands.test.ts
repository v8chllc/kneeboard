import { describe, expect, it } from "vitest";

import type { TrackerCommand } from "./commands";

/**
 * Exhaustively narrows a {@link TrackerCommand}. The `never` assignment in the
 * default branch fails type checking if a member is added to the union without
 * being handled here, which is the guarantee the transition engine will depend
 * on when it dispatches commands.
 */
function describeCommand(command: TrackerCommand): string {
  switch (command.type) {
    case "saveWaypoint":
      return `save ${command.routeIndex}`;
    case "passWaypoint":
      return `pass ${command.routeIndex}`;
    case "skipWaypoint":
      return `skip ${command.routeIndex}`;
    case "setProcedureInclusion":
      return `inclusion sid=${command.inclusion.sid} star=${command.inclusion.star}`;
    default: {
      const unhandled: never = command;
      throw new Error(`Unhandled tracker command: ${JSON.stringify(unhandled)}`);
    }
  }
}

describe("TrackerCommand", () => {
  it("is exhaustively switchable over every command type", () => {
    const commands: TrackerCommand[] = [
      { type: "saveWaypoint", expectedVersion: 1, routeIndex: 3 },
      { type: "passWaypoint", expectedVersion: 2, routeIndex: 4 },
      { type: "skipWaypoint", expectedVersion: 3, routeIndex: 5 },
      {
        type: "setProcedureInclusion",
        expectedVersion: 4,
        inclusion: { sid: true, star: false },
      },
    ];

    expect(commands.map(describeCommand)).toEqual([
      "save 3",
      "pass 4",
      "skip 5",
      "inclusion sid=true star=false",
    ]);
  });
});

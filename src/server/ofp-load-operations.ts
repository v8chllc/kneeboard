import { z } from "zod";

import type { OfpLoadResult, PreparedOfpLoad } from "../db/ofp-load";
import { buildNavlog } from "../domain/navlog-construction";
import { SimbriefOfpError, type FetchedSimbriefOfp, type SimbriefOfpFailure } from "./simbrief-ofp";

export type LoadUiResult =
  | { readonly status: "created" | "completed"; readonly trackerId: string; readonly message: string }
  | { readonly status: "inProgress" | "wait"; readonly message: string; readonly remainingMs: number }
  | { readonly status: "failed" | "signInRequired" | "pilotIdRequired" | "invalidAction"; readonly message: string };

export interface LoadDependencies {
  readonly resolveAccountId: (headers: Headers) => Promise<string | null>;
  readonly readPilotId: (accountId: string) => Promise<string | null>;
  readonly load: (accountId: string, key: string, work: () => Promise<PreparedOfpLoad>) => Promise<OfpLoadResult>;
  readonly fetch: (pilotId: string) => Promise<FetchedSimbriefOfp>;
}

function unreachable(value: never): never {
  void value;
  throw new Error("Unmapped load outcome");
}

/** Exhaustively translate persistence outcomes into safe user-facing results. */
export function mapLoadResult(result: OfpLoadResult, failure?: SimbriefOfpFailure): LoadUiResult {
  switch (result.outcome) {
    case "created":
      return { status: "created", trackerId: result.trackerId, message: "OFP loaded. Opening your tracker." };
    case "completed":
      return { status: "completed", trackerId: result.trackerId, message: "This load already completed. Opening your tracker." };
    case "inProgress":
      return { status: "inProgress", remainingMs: result.remainingMs, message: "This load is still running. Retry the same action shortly." };
    case "wait":
      return { status: "wait", remainingMs: result.remainingMs, message: `Wait ${Math.ceil(result.remainingMs / 1000)} seconds before another load.` };
    case "failed":
      if (failure === "nonLido") return { status: "failed", message: "Only the LIDO layout is supported. Regenerate your OFP with LIDO selected, then retry." };
      if (failure === "missingNavlog") return { status: "failed", message: "The detailed navlog is missing. Regenerate your OFP with the detailed navlog enabled, then retry." };
      return { status: "failed", message: "The OFP could not be loaded. Check your plan and try again." };
    default:
      return unreachable(result);
  }
}

const actionKey = z.uuid();

/** Resolve account and saved Pilot ID on the server before reserving any load. */
export function createLoadOperation(dependencies: LoadDependencies) {
  return async (headers: Headers, key: unknown): Promise<LoadUiResult> => {
    const parsedKey = actionKey.safeParse(key);
    let failure: SimbriefOfpFailure | undefined;
    try {
      const accountId = await dependencies.resolveAccountId(headers);
      if (accountId === null) return { status: "signInRequired", message: "Sign in to load an OFP." };
      if (!parsedKey.success) return { status: "invalidAction", message: "The load action expired. Try again." };
      const pilotId = await dependencies.readPilotId(accountId);
      if (pilotId === null) return { status: "pilotIdRequired", message: "Save your SimBrief Pilot ID before loading an OFP." };

      const result = await dependencies.load(accountId, parsedKey.data, async () => {
        try {
          const fetched = await dependencies.fetch(pilotId);
          return { rawPayload: fetched.rawPayload, navlog: buildNavlog(fetched.ofpInput) };
        } catch (error) {
          failure = error instanceof SimbriefOfpError ? error.reason : "upstream";
          throw error;
        }
      });
      return mapLoadResult(result, failure);
    } catch {
      return { status: "failed", message: "The OFP could not be loaded. Check your plan and try again." };
    }
  };
}

import "server-only";

import { createAccountSettingsOperations, resolveAccountId as resolveSessionAccountId } from "./account-settings-operations";
import { getAuth } from "./auth";
import { getDatabase } from "./database";

/** Server transport calls this with request headers; no account ID is accepted. */
export function getAccountSettings() {
  return createAccountSettingsOperations(getDatabase(), getAuth());
}

/** Home can choose visitor or signed-in state without querying settings. */
export async function resolveAccountId(headers: Headers): Promise<string | null> {
  return resolveSessionAccountId(getAuth(), headers);
}

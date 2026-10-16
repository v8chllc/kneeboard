import "server-only";

import { parseServerConfig } from "./config";

/** Shared validated environment for server auth and account operations. */
export const serverConfig = parseServerConfig(process.env);

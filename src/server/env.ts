import "server-only";

import { parseServerConfig, type ServerConfig } from "./config";

let cached: ServerConfig | undefined;

/** Validate once when a server operation first needs configuration. */
export function getServerConfig(): ServerConfig {
  return cached ??= parseServerConfig(process.env);
}

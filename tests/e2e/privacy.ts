import { expect, type APIRequestContext } from "@playwright/test";

/**
 * Register one unique private value with the journey's in-memory log verifier.
 * JOURNEY_SENTINEL_PORT must name its isolated loopback receiver. Call once per
 * identity (for example email-a, pilot-a, session-a, session-repeat-0,
 * token:<hash>, or fault-token:<hash>); the receiver
 * rejects duplicate identities and the final verifier rejects duplicate values.
 * Registration sends the value only to that receiver, never to app output.
 * Missing configuration, an empty value, or a rejected POST fails the journey.
 */
export async function registerSensitive(request: APIRequestContext, identity: string, value: string): Promise<void> {
  const port = process.env.JOURNEY_SENTINEL_PORT;
  if (!port || !/^\d+$/.test(port) || !value) throw new Error("Isolated sentinel receiver is required");
  const response = await request.post(`http://127.0.0.1:${port}/`, { data: { identity, value } });
  expect(response.status()).toBe(204);
}

import { expect, type APIRequestContext } from "@playwright/test";
import { createHash } from "node:crypto";
import { z } from "zod";

import { registerSensitive } from "./privacy";

const summarySchema = z.object({
  total: z.number(),
  messages: z.array(z.object({
    ID: z.string(),
    To: z.array(z.object({ Address: z.string() })),
  })),
});
const detailSchema = z.object({ Text: z.string() });

function apiUrl(path: string): string {
  const base = process.env.MAILPIT_API_URL;
  if (!base) throw new Error("Isolated Mailpit API is required");
  const parsed = new URL(base);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !parsed.port ||
      parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("Isolated Mailpit API is required");
  }
  return `${parsed.origin}${path}`;
}

export async function listMessages(request: APIRequestContext) {
  const response = await request.get(apiUrl("/api/v1/messages"), { timeout: 1000 });
  expect(response.ok()).toBe(true);
  return summarySchema.parse(await response.json());
}

export async function clearInbox(request: APIRequestContext): Promise<void> {
  const response = await request.delete(apiUrl("/api/v1/messages"), { data: { IDs: [] } });
  expect(response.ok()).toBe(true);
  expect((await listMessages(request)).total).toBe(0);
}

/**
 * Read exactly `count` magic links for `recipient` from isolated Mailpit.
 * MAILPIT_API_URL must be an isolated 127.0.0.1 HTTP endpoint and
 * JOURNEY_SENTINEL_PORT must name the isolated privacy receiver. `category`
 * labels each unique token identity as `category:<sha256(token)>`: use `token`
 * for normal links and `fault-token` for fault journeys. This registers every
 * raw token with the log verifier, then deletes the entire inbox after reading.
 * The call fails on invalid configuration or count, timeout, wrong recipient,
 * malformed mail/link/token, failed registration, or failed inbox deletion.
 */
export async function readLinks(request: APIRequestContext, recipient: string, count: number, category = "token"): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error("Expected one to five isolated messages");
  let messages: Awaited<ReturnType<typeof listMessages>>["messages"] = [];
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const listing = await listMessages(request);
    messages = listing.messages;
    if (listing.total >= count) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  expect(messages).toHaveLength(count);
  const links: string[] = [];
  for (const message of messages) {
    expect(message.To.some((address) => address.Address === recipient)).toBe(true);
    const response = await request.get(apiUrl(`/api/v1/message/${encodeURIComponent(message.ID)}`));
    expect(response.ok()).toBe(true);
    const detail = detailSchema.parse(await response.json());
    const link = detail.Text.match(/https?:\/\/\S+/)?.[0];
    expect(Boolean(link)).toBe(true);
    const token = new URL(link!).searchParams.get("token");
    expect(Boolean(token)).toBe(true);
    await registerSensitive(request, `${category}:${createHash("sha256").update(token!).digest("hex")}`, token!);
    links.push(link!);
  }
  await clearInbox(request);
  return links;
}

export async function readOneLink(request: APIRequestContext, recipient: string, category = "token"): Promise<string> {
  return (await readLinks(request, recipient, 1, category))[0];
}

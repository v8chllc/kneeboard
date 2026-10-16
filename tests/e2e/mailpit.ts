import { expect, type APIRequestContext } from "@playwright/test";
import { z } from "zod";

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

/** Finite REST poll, then read exactly one message and remove it from the inbox. */
export async function readOneLink(request: APIRequestContext, recipient: string): Promise<string> {
  let messages: Awaited<ReturnType<typeof listMessages>>["messages"] = [];
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const listing = await listMessages(request);
    messages = listing.messages;
    if (listing.total > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  expect(messages).toHaveLength(1);
  expect(messages[0].To.some((address) => address.Address === recipient)).toBe(true);
  const response = await request.get(apiUrl(`/api/v1/message/${encodeURIComponent(messages[0].ID)}`));
  expect(response.ok()).toBe(true);
  const detail = detailSchema.parse(await response.json());
  const link = detail.Text.match(/https?:\/\/\S+/)?.[0];
  expect(Boolean(link)).toBe(true);
  await clearInbox(request);
  return link!;
}

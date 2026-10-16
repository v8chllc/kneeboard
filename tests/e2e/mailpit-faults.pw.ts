import { expect, test } from "@playwright/test";

import { clearInbox, listMessages, readOneLink } from "./mailpit";

test("stale inbox is cleared and a wrong local API destination fails closed", async ({ request }) => {
  const email = process.env.JOURNEY_EMAIL_B;
  const origin = process.env.PLAYWRIGHT_BASE_URL;
  const originalApi = process.env.MAILPIT_API_URL;
  if (!email || !origin || !originalApi) throw new Error("Isolated journey configuration is required");

  await clearInbox(request);
  const response = await request.post("/api/auth/sign-in/magic-link", {
    headers: { origin, "x-forwarded-for": "192.0.2.121" }, data: { email },
  });
  expect(response.status()).toBe(200);
  expect((await listMessages(request)).total).toBe(1);
  await readOneLink(request, email, "fault-token");
  expect((await listMessages(request)).total).toBe(0);
  console.log("JOURNEY stale inbox clearing: pass");

  try {
    process.env.MAILPIT_API_URL = `${originalApi}/wrong-path`;
    await expect(listMessages(request)).rejects.toThrow("Isolated Mailpit API is required");
  } finally {
    process.env.MAILPIT_API_URL = originalApi;
  }
  console.log("JOURNEY wrong Mailpit API destination: pass");
});

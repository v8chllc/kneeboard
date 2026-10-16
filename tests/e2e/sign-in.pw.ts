import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { Pool } from "pg";

import { localTestDatabaseUrl } from "../support/local-test-db";
import { clearInbox, listMessages, readLinks, readOneLink } from "./mailpit";

test("isolated magic-link sign-in, Pilot ID, account isolation, and privacy sentinels", async ({ browser, request }) => {
  test.setTimeout(90000);
  const url = localTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const emailA = process.env.JOURNEY_EMAIL_A;
  const emailB = process.env.JOURNEY_EMAIL_B;
  const sentinelPort = process.env.JOURNEY_SENTINEL_PORT;
  if (!url || !emailA || !emailB || !sentinelPort) throw new Error("Isolated journey configuration is required");
  const pool = new Pool({ connectionString: url });
  const pilotA = "00135791";
  const pilotB = "00246802";
  try {
    await clearInbox(request);
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.goto("/");
    await expect(pageA.getByRole("heading", { name: "Sign in with a magic link" })).toBeVisible();
    await expect(pageA.getByRole("textbox", { name: "Pilot ID" })).toHaveCount(0);
    await expect(pageA.getByRole("complementary", { name: "Simulation-only warning" })).toBeVisible();
    console.log("JOURNEY visitor state: pass");

    const emailInput = pageA.getByRole("textbox", { name: "Email address" });
    for (const invalid of ["", "malformed-address"]) {
      await emailInput.fill(invalid);
      await pageA.getByRole("button", { name: "Email me a sign-in link" }).click();
      expect(await emailInput.evaluate((element) => (element as HTMLInputElement).validity.valid)).toBe(false);
      expect(await emailInput.evaluate((element) => (element as HTMLInputElement).validationMessage.length > 0)).toBe(true);
    }
    for (const invalid of ["", "malformed-address", null]) {
      const response = await request.post("/api/auth/sign-in/magic-link", {
        headers: { origin: process.env.PLAYWRIGHT_BASE_URL!, "x-forwarded-for": "192.0.2.89" },
        data: { email: invalid },
      });
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect((await response.text()).includes("malformed-address")).toBe(false);
    }
    expect((await listMessages(request)).total).toBe(0);
    console.log("JOURNEY malformed email boundary: pass");

    await pageA.getByRole("textbox", { name: "Email address" }).fill(emailB.replace("journey-b-", "denied-"));
    await pageA.getByRole("button", { name: "Email me a sign-in link" }).click();
    const deniedResponse = await pageA.getByRole("status").innerText();
    expect((await listMessages(request)).total).toBe(0);
    const deniedRows = await pool.query('select count(*)::int as count from "user" where email = $1',
      [emailB.replace("journey-b-", "denied-")]);
    expect(deniedRows.rows[0].count).toBe(0);

    await pageA.getByRole("textbox", { name: "Email address" }).fill(emailA);
    await pageA.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(pageA.getByRole("status")).toHaveText(deniedResponse);
    const linkA = await readOneLink(request, emailA);
    const tokenA = new URL(linkA).searchParams.get("token");
    expect(Boolean(tokenA)).toBe(true);
    const verification = await pool.query("select identifier from verification");
    const expectedHash = createHash("sha256").update(tokenA!).digest("hex");
    expect(verification.rows.some((row) => row.identifier === expectedHash)).toBe(true);
    expect(expectedHash === tokenA).toBe(false);
    console.log("JOURNEY allowlist and hashed link: pass");

    await pageA.goto(linkA);
    await expect(pageA.getByRole("heading", { name: "Set up your SimBrief Pilot ID" })).toBeVisible();
    await expect(pageA.getByRole("complementary", { name: "Simulation-only warning" })).toBeVisible();
    const cookies = await contextA.cookies();
    const sessionCookie = cookies.find((cookie) => cookie.name.endsWith("session_token"));
    expect(Boolean(sessionCookie?.value)).toBe(true);
    const reusedContext = await browser.newContext();
    const reusedPage = await reusedContext.newPage();
    await reusedPage.goto(linkA);
    await expect(reusedPage.getByRole("heading", { name: "Sign in with a magic link" })).toBeVisible();
    console.log("JOURNEY single-use link: pass");

    const inputA = pageA.getByRole("textbox", { name: "Pilot ID" });
    await inputA.fill(pilotA);
    await pageA.getByRole("button", { name: "Save Pilot ID" }).click();
    await expect(pageA.getByRole("status")).toHaveText("Pilot ID saved.");
    await pageA.reload();
    expect((await pageA.getByRole("textbox", { name: "Pilot ID" }).inputValue()) === pilotA).toBe(true);
    const storedA = await pool.query('select s.pilot_id from account_settings s join "user" u on u.id = s.user_id where u.email = $1', [emailA]);
    expect(storedA.rows.length === 1 && storedA.rows[0].pilot_id === pilotA).toBe(true);

    await pageA.getByRole("textbox", { name: "Pilot ID" }).fill("");
    await pageA.getByRole("button", { name: "Save Pilot ID" }).click();
    expect(await pageA.getByRole("textbox", { name: "Pilot ID" }).evaluate(
      (element) => (element as HTMLInputElement).validity.valueMissing,
    )).toBe(true);
    for (const invalid of ["12a", "12345678901234567"]) {
      const input = pageA.getByRole("textbox", { name: "Pilot ID" });
      await input.evaluate((element) => {
        element.removeAttribute("required"); element.removeAttribute("pattern");
        element.removeAttribute("minlength"); element.removeAttribute("maxlength");
      });
      await input.fill(invalid);
      await pageA.getByRole("button", { name: "Save Pilot ID" }).click();
      await expect(pageA.getByText("Enter 1–16 digits for your Pilot ID.")).toBeVisible();
      const unchanged = await pool.query('select s.pilot_id from account_settings s join "user" u on u.id = s.user_id where u.email = $1', [emailA]);
      expect(unchanged.rows[0].pilot_id === pilotA).toBe(true);
    }
    console.log("JOURNEY Pilot ID persistence and validation: pass");

    await clearInbox(request);
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto("/");
    await pageB.getByRole("textbox", { name: "Email address" }).fill(emailB);
    await pageB.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(pageB.getByRole("status")).toBeVisible();
    const linkB = await readOneLink(request, emailB);
    const tokenB = new URL(linkB).searchParams.get("token");
    expect(Boolean(tokenB)).toBe(true);
    await pageB.goto(linkB);
    await expect(pageB.getByRole("heading", { name: "Set up your SimBrief Pilot ID" })).toBeVisible();
    const sessionCookieB = (await contextB.cookies()).find((cookie) => cookie.name.endsWith("session_token"));
    expect(Boolean(sessionCookieB?.value)).toBe(true);
    await pageB.getByRole("textbox", { name: "Pilot ID" }).fill(pilotB);
    await pageB.getByRole("button", { name: "Save Pilot ID" }).click();
    await expect(pageB.getByRole("status")).toHaveText("Pilot ID saved.");
    await pageB.reload();
    expect((await pageB.getByRole("textbox", { name: "Pilot ID" }).inputValue()) === pilotB).toBe(true);
    await pageA.reload();
    expect((await pageA.getByRole("textbox", { name: "Pilot ID" }).inputValue()) === pilotA).toBe(true);
    const storedB = await pool.query('select s.user_id, s.pilot_id from account_settings s join "user" u on u.id = s.user_id where u.email = $1', [emailB]);
    expect(storedB.rows.length === 1 && storedB.rows[0].pilot_id === pilotB).toBe(true);
    await pageA.locator("form").evaluate((form, otherAccountId) => {
      for (const name of ["accountId", "userId"]) {
        const hint = document.createElement("input");
        hint.type = "hidden";
        hint.name = name;
        hint.value = otherAccountId;
        form.append(hint);
      }
    }, storedB.rows[0].user_id);
    await contextA.setExtraHTTPHeaders({ "x-user-id": storedB.rows[0].user_id });
    await pageA.getByRole("textbox", { name: "Pilot ID" }).fill(pilotA);
    await pageA.getByRole("button", { name: "Save Pilot ID" }).click();
    await expect(pageA.getByRole("status")).toHaveText("Pilot ID saved.");
    expect((await pool.query('select pilot_id from account_settings where user_id=$1', [storedB.rows[0].user_id])).rows[0].pilot_id).toBe(pilotB);
    await contextA.setExtraHTTPHeaders({});
    console.log("JOURNEY two-account isolation: pass");

    await clearInbox(request);
    const beforeRates = await pool.query("select id, count from rate_limit");
    const countsBefore = new Map(beforeRates.rows.map((row) => [row.id, row.count]));
    for (let index = 0; index < 5; index += 1) {
      const response = await request.post("/api/auth/sign-in/magic-link", {
        headers: { origin: process.env.PLAYWRIGHT_BASE_URL!, "x-forwarded-for": "192.0.2.77" },
        data: { email: emailA },
      });
      expect(response.status()).toBe(200);
    }
    const limited = await request.post("/api/auth/sign-in/magic-link", {
      headers: { origin: process.env.PLAYWRIGHT_BASE_URL!, "x-forwarded-for": "192.0.2.77" },
      data: { email: emailA },
    });
    expect(limited.status()).toBe(429);
    const rateLinks = await readLinks(request, emailA, 5);
    const rates = await pool.query("select id, count from rate_limit");
    expect(rates.rows.some((row) => row.count >= 5 && row.count > (countsBefore.get(row.id) ?? 0))).toBe(true);
    console.log("JOURNEY database rate limit: pass");

    await pageA.getByRole("button", { name: "Sign out" }).click();
    await expect(pageA.getByRole("heading", { name: "Sign in with a magic link" })).toBeVisible();
    await pageA.reload();
    await expect(pageA.getByRole("heading", { name: "Sign in with a magic link" })).toBeVisible();
    await expect(pageA.getByRole("textbox", { name: "Pilot ID" })).toHaveCount(0);
    const formerSession = await browser.newContext();
    await formerSession.addCookies([sessionCookie!]);
    const formerPage = await formerSession.newPage();
    await formerPage.goto("/");
    await expect(formerPage.getByRole("heading", { name: "Sign in with a magic link" })).toBeVisible();
    await expect(formerPage.getByRole("textbox", { name: "Pilot ID" })).toHaveCount(0);
    console.log("JOURNEY sign-out: pass");

    // Both links remain independently usable until consumed. Each then stays used.
    const requestedLinks: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const response = await request.post("/api/auth/sign-in/magic-link", {
        headers: { origin: process.env.PLAYWRIGHT_BASE_URL!, "x-forwarded-for": "192.0.2.88" },
        data: { email: emailA },
      });
      expect(response.status()).toBe(200);
      requestedLinks.push(await readOneLink(request, emailA));
    }
    expect(requestedLinks[0]).not.toBe(requestedLinks[1]);
    const repeatedCookies: string[] = [];
    for (const [index, link] of requestedLinks.entries()) {
      const fresh = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `192.0.2.${90 + index}` } });
      const page = await fresh.newPage();
      await page.goto(link);
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      const cookie = (await fresh.cookies()).find((item) => item.name.endsWith("session_token"));
      expect(cookie?.value).toBeTruthy();
      repeatedCookies.push(cookie!.value);
      const used = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `192.0.2.${100 + index}` } });
      const usedPage = await used.newPage();
      await usedPage.goto(link);
      await expect(usedPage.getByRole("heading", { name: "Sign in with a magic link" })).toBeVisible();
      expect((await used.cookies()).some((item) => item.name.endsWith("session_token"))).toBe(false);
    }
    expect(repeatedCookies[0]).not.toBe(repeatedCookies[1]);
    console.log("JOURNEY repeated distinct links: pass");

    const concurrentRequest = await request.post("/api/auth/sign-in/magic-link", {
      headers: { origin: process.env.PLAYWRIGHT_BASE_URL!, "x-forwarded-for": "192.0.2.87" },
      data: { email: emailA },
    });
    expect(concurrentRequest.status()).toBe(200);
    const concurrentLink = await readOneLink(request, emailA);
    const concurrentContexts = await Promise.all([110, 111].map((octet) =>
      browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `192.0.2.${octet}` } }),
    ));
    const concurrentPages = await Promise.all(concurrentContexts.map((context) => context.newPage()));
    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Both redemption requests did not reach the barrier")), 10000);
      release = () => { clearTimeout(timeout); resolve(); };
    });
    for (const page of concurrentPages) {
      await page.route("**/api/auth/magic-link/verify?**", async (route) => {
        arrivals += 1;
        if (arrivals === 2) release();
        await gate;
        await route.continue();
      });
    }
    const beforeSessions = await pool.query('select count(*)::int as count from session s join "user" u on u.id=s.user_id where u.email=$1', [emailA]);
    await Promise.all(concurrentPages.map((page) => page.goto(concurrentLink)));
    expect(arrivals).toBe(2);
    const concurrentCookies = await Promise.all(concurrentContexts.map(async (context) =>
      (await context.cookies()).find((item) => item.name.endsWith("session_token"))?.value,
    ));
    expect(concurrentCookies.filter(Boolean)).toHaveLength(1);
    const afterSessions = await pool.query('select count(*)::int as count from session s join "user" u on u.id=s.user_id where u.email=$1', [emailA]);
    expect(afterSessions.rows[0].count).toBe(beforeSessions.rows[0].count + 1);
    await expect(concurrentPages[concurrentCookies[0] ? 0 : 1].getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(concurrentPages[concurrentCookies[0] ? 1 : 0].getByRole("heading", { name: "Sign in with a magic link" })).toBeVisible();
    console.log("JOURNEY simultaneous redemption: pass");

    const sentinels = { values: [emailA, tokenA!, sessionCookie!.value, pilotA, emailB, tokenB!, sessionCookieB!.value, pilotB,
      ...rateLinks.map((link) => new URL(link).searchParams.get("token")!),
      ...requestedLinks.map((link) => new URL(link).searchParams.get("token")!), ...repeatedCookies,
      new URL(concurrentLink).searchParams.get("token")!, ...concurrentCookies.filter((value): value is string => Boolean(value))] };
    const response = await request.post(`http://127.0.0.1:${sentinelPort}/`, { data: sentinels });
    expect(response.status()).toBe(204);
  } finally {
    await pool.end();
  }
});

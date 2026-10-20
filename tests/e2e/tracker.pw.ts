import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";

import { previewPass, type TrackerSnapshot } from "../../src/domain";
import { localTestDatabaseUrl } from "../support/local-test-db";
import reservedIds from "../fixtures/simbrief/stub-map.json";
import { clearInbox, readOneLink } from "./mailpit";
import { registerSensitive } from "./privacy";

const PILOT_ID = "100001";
if (reservedIds[PILOT_ID] !== "valid-multi-page.json") throw new Error("Tracker fixture mapping changed");

function isolatedSettings() {
  const databaseUrl = localTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const stubUrl = process.env.SIMBRIEF_STUB_URL;
  if (!databaseUrl || !stubUrl || new URL(stubUrl).hostname !== "127.0.0.1") {
    throw new Error("Isolated tracker journey configuration is required");
  }
  return { databaseUrl, stubUrl };
}

async function stubCount(request: APIRequestContext, origin: string): Promise<number> {
  const response = await request.get(`${origin}/__requests`);
  expect(response.status()).toBe(200);
  const counts = await response.json() as Record<string, number>;
  return counts[PILOT_ID] ?? 0;
}

async function signInAndLoad(context: BrowserContext, request: APIRequestContext, email: string, identity: string) {
  const { stubUrl } = isolatedSettings();
  const before = await stubCount(request, stubUrl);
  await clearInbox(request);
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.goto(await readOneLink(request, email));
  await expect(page.getByRole("heading", { name: "Set up your SimBrief Pilot ID" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load latest OFP", exact: true })).toBeDisabled();
  const cookie = (await context.cookies()).find((item) => item.name.endsWith("session_token"));
  expect(cookie?.value).toBeTruthy();
  await registerSensitive(request, `email-tracker-${identity}`, email);
  await registerSensitive(request, `session-tracker-${identity}`, cookie!.value);
  if (identity === "a") await registerSensitive(request, "pilot-stub", PILOT_ID);
  await page.getByRole("textbox", { name: "Pilot ID" }).fill(PILOT_ID);
  await page.getByRole("button", { name: "Save Pilot ID" }).click();
  await expect(page.getByRole("status")).toHaveText("Pilot ID saved.");
  await page.reload();
  await expect(page.getByRole("button", { name: "Load latest OFP", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Load latest OFP", exact: true }).click();
  await expect(page).toHaveURL(/\/trackers\/[0-9a-f-]{36}$/, { timeout: 10_000 });
  await expect.poll(() => stubCount(request, stubUrl)).toBe(before + 1);
  const trackerId = page.url().split("/").at(-1)!;
  return { page, trackerId };
}

async function trackerRow(pool: Pool, trackerId: string, email: string) {
  const result = await pool.query(
    'SELECT t.id, t.navlog, t.snapshot, t.version, l.flight_number, l.generated_at, l.loaded_at, u.email FROM tracker t JOIN ofp_load l ON l.id = t.load_id JOIN "user" u ON u.id = t.user_id WHERE t.id = $1',
    [trackerId],
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].email).toBe(email);
  return result.rows[0] as { id: string; navlog: { points: { ident: string }[] }; snapshot: TrackerSnapshot; version: number; flight_number: string; generated_at: Date; loaded_at: Date; email: string };
}

function utcAviation(date: Date): string {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(date.getUTCDate()).padStart(2, "0")} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}Z`;
}

test("valid fixture Load creates an owned tracker at phone width", async ({ browser, request }, testInfo) => {
  test.setTimeout(90_000);
  const email = process.env.JOURNEY_TRACKER_EMAIL_A;
  if (!email) throw new Error("Isolated tracker email is required");
  const pool = new Pool({ connectionString: isolatedSettings().databaseUrl });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const loaded = await signInAndLoad(context, request, email, "a");
    const { page, trackerId } = loaded;
    const row = await trackerRow(pool, trackerId, email);
    expect(row.version).toBe(1);
    await expect(page.getByRole("heading", { name: row.flight_number })).toBeVisible();
    await expect(page.getByText("KLAX → KJFK")).toBeVisible();
    await expect(page.getByText("For home flight simulation only.", { exact: false })).toBeVisible();
    await expect(page.locator("li.tracker-row")).toHaveCount(43);
    expect(row.generated_at.toISOString()).toBe("2026-01-01T00:00:02.000Z");
    await expect(page.locator(".tracker-times dd")).toHaveText([
      "01 JAN 2026 0000Z", utcAviation(row.loaded_at),
    ]);
    const pages = page.locator("li.tracker-row:has(.tracker-page-rule)");
    await expect(pages.locator(".tracker-page-rule")).toHaveText(["Page 1", "Page 2", "Page 3", "Page 4", "Page 5"]);
    await expect(pages.locator(".tracker-ident")).toHaveText(["KLAX", "SEBBY", "MOCTU", "BEWEL", "NWTON"]);
    await expect(pages.locator(".tracker-slot")).toHaveText(["1", "1", "1", "1"]);
    await expect(page.locator("li.tracker-row").nth(19).locator(".tracker-slot")).toHaveText("9");
    await expect(page.locator("li.tracker-row").nth(38).locator(".tracker-slot")).toHaveText("9");
    await expect(page.locator("li.tracker-row").nth(35).locator(".tracker-ident")).toHaveText("TOD");
    await expect(page.locator("li.tracker-row").last().locator(".tracker-ident")).toHaveText("KJFK");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    for (const button of await page.locator(".tracker-shell button").all()) {
      const box = await button.boundingBox();
      expect(box?.width).toBeGreaterThan(0);
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
    await testInfo.attach("tracker-phone", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    console.log("JOURNEY fixture Load and phone tracker: pass");
  } finally {
    await context?.close();
    await pool.end();
  }
});

test("Save, single Pass, confirmed cascade and Skip persist after reload", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const email = process.env.JOURNEY_TRACKER_EMAIL_B;
  if (!email) throw new Error("Isolated tracker email is required");
  const pool = new Pool({ connectionString: isolatedSettings().databaseUrl });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const loaded = await signInAndLoad(context, request, email, "b");
    const { page, trackerId } = loaded;
    const sid = page.getByRole("button", { name: "SID included" });
    await sid.click();
    await expect(page.getByRole("button", { name: "SID excluded" })).toBeVisible();
    await page.getByRole("button", { name: "SID excluded" }).click();
    await expect(sid).toBeVisible();
    const stalePage = await context.newPage();
    await stalePage.goto(page.url());
    const versionBeforeFailure = (await trackerRow(pool, trackerId, email)).version;
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(1);
    await expect(page.locator('li.tracker-row[data-state="pending"]').first().getByRole("button", { name: "Save" })).toBeVisible();
    const displayBeforeFailure = await page.locator(".tracker-route-list ol").innerText();
    let releaseRequest!: () => void;
    let requestStarted!: () => void;
    const heldRequest = new Promise<void>((resolve) => { releaseRequest = resolve; });
    const requestSeen = new Promise<void>((resolve) => { requestStarted = resolve; });
    await page.route("**/trackers/*", async (route) => {
      if (route.request().method() === "POST") {
        requestStarted();
        await heldRequest;
        await route.abort("failed");
      }
      else await route.continue();
    }, { times: 1 });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await Promise.race([requestSeen, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Tracker POST did not start")), 10_000))]);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(page.locator(".tracker-shell button:enabled")).toHaveCount(0);
    expect(await page.locator(".tracker-route-list ol").innerText()).toBe(displayBeforeFailure);
    expect((await trackerRow(pool, trackerId, email)).version).toBe(versionBeforeFailure);
    releaseRequest();
    await expect(page.locator(".tracker-notice")).toContainText("Tracker could not be updated");
    await expect(page.locator('li.tracker-row[data-state="saved"]')).toHaveCount(0);
    expect((await trackerRow(pool, trackerId, email)).version).toBe(versionBeforeFailure);
    await page.unrouteAll();
    for (let count = 1; count <= 3; count += 1) {
      await page.getByRole("button", { name: "Save", exact: true }).first().click();
      await expect(page.locator('li.tracker-row[data-state="saved"]')).toHaveCount(count);
      await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(1);
      if (count === 1) {
        await stalePage.getByRole("button", { name: "Save", exact: true }).first().click();
        await expect(stalePage.locator(".tracker-notice")).toContainText("Tracker changed. Reload and try again.");
        await expect(stalePage.locator('li.tracker-row[data-state="saved"]')).toHaveCount(0);
        await expect(stalePage.getByRole("button", { name: "Reload tracker" })).toBeVisible();
        await stalePage.getByRole("button", { name: "Reload tracker" }).click();
        await expect(stalePage.locator('li.tracker-row[data-state="saved"]')).toHaveCount(1);
        await stalePage.close();
      }
    }
    await expect(page.getByRole("button", { name: "SID included" })).toBeDisabled();
    await expect(page.locator('li.tracker-row[data-window="true"]')).toHaveCount(3);
    await page.locator('li.tracker-row[data-state="saved"]').first().getByRole("button", { name: "Pass" }).click();
    await expect(page.locator('li.tracker-row[data-state="passed"]')).toHaveCount(1);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator('li.tracker-row[data-state="saved"]').last().getByRole("button", { name: "Pass" }).click();
    const dialog = page.getByRole("dialog", { name: "Pass these waypoints?" });
    await expect(dialog).toBeVisible();
    const beforeCascade = await trackerRow(pool, trackerId, email);
    const savedIndexes = beforeCascade.snapshot.waypoints.filter((fix) => fix.state === "saved").map((fix) => fix.routeIndex);
    const preview = previewPass(beforeCascade.snapshot, savedIndexes.at(-1)!);
    expect(preview.outcome).toBe("selected");
    if (preview.outcome !== "selected") throw new Error("Expected cascade selection");
    await expect(dialog.locator("li")).toHaveText(preview.routeIndexes.map((index) =>
      `${beforeCascade.navlog.points[index].ident} · route position ${index}`));
    const versionBeforeCancel = beforeCascade.version;
    expect((await trackerRow(pool, trackerId, email)).snapshot.waypoints.filter((point) => point.state === "passed")).toHaveLength(1);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect((await trackerRow(pool, trackerId, email)).version).toBe(versionBeforeCancel);
    expect((await trackerRow(pool, trackerId, email)).snapshot.waypoints.filter((point) => point.state === "passed")).toHaveLength(1);
    await page.locator('li.tracker-row[data-state="saved"]').last().getByRole("button", { name: "Pass" }).click();
    await page.getByRole("dialog", { name: "Pass these waypoints?" }).getByRole("button", { name: "Pass listed waypoints" }).click();
    await expect(page.locator('li.tracker-row[data-state="passed"]')).toHaveCount(3);
    const pendingBeforeSkip = page.locator('li.tracker-row[data-state="pending"]').first();
    const skippedIdent = await pendingBeforeSkip.locator(".tracker-ident").innerText();
    const nextIdent = await page.locator('li.tracker-row[data-state="pending"]').nth(1).locator(".tracker-ident").innerText();
    await page.locator('li.tracker-row[data-state="pending"]').first().getByRole("button", { name: "Skip" }).click();
    await expect(page.locator('li.tracker-row[data-state="skipped"]')).toHaveCount(1);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('li.tracker-row[data-state="skipped"]').locator(".tracker-ident")).toHaveText(skippedIdent);
    await expect(page.locator('li.tracker-row[data-state="pending"]').first().locator(".tracker-ident")).toHaveText(nextIdent);
    expect((await trackerRow(pool, trackerId, email)).snapshot.waypoints.filter((point) => point.state === "skipped")).toHaveLength(1);
    await page.reload();
    await expect(page.locator('li.tracker-row[data-state="passed"]')).toHaveCount(3);
    await expect(page.locator('li.tracker-row[data-state="skipped"]')).toHaveCount(1);
    await expect(page.getByRole("button", { name: "STAR included" })).toBeDisabled();
    console.log("JOURNEY persisted tracker workflow: pass");
  } finally {
    await context?.close();
    await pool.end();
  }
});

import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";

import { previewPass, type TrackerSnapshot } from "../../src/domain";
import { localTestDatabaseUrl } from "../support/local-test-db";
import multiPageFixture from "../fixtures/simbrief/valid-multi-page.json";
import reservedIds from "../fixtures/simbrief/stub-map.json";
import { clearInbox, readOneLink } from "./mailpit";
import { registerSensitive } from "./privacy";

const PILOT_ID = "100001";
if (reservedIds[PILOT_ID] !== "valid-multi-page.json") throw new Error("Tracker fixture mapping changed");
const expectedRoute = [multiPageFixture.origin.icao_code, ...multiPageFixture.navlog.fix.map((fix) => fix.ident)];
const viewports = [
  { label: "phone", width: 390, height: 844 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop", width: 1440, height: 900 },
] as const;

async function expectUsableViewport(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  for (const control of await page.locator("a:visible, button:visible, input:visible").all()) {
    const box = await control.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(24);
    expect(box?.height).toBeGreaterThanOrEqual(24);
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
}

async function expectTextContrast(page: Page, samples: readonly { text: string; surface: string }[]) {
  for (const sample of samples) {
    const colors = await page.evaluate(({ text, surface }) => {
      const foreground = document.querySelector(text);
      const background = document.querySelector(surface);
      if (!foreground || !background) throw new Error(`Missing contrast sample ${text} or ${surface}`);
      const toRgb = (color: string) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas color conversion unavailable");
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      return [toRgb(getComputedStyle(foreground).color), toRgb(getComputedStyle(background).backgroundColor)];
    }, sample);
    const luminance = (values: number[]) => {
      const [red, green, blue] = values.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const [foreground, background] = colors.map(luminance);
    expect((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05), sample.text).toBeGreaterThanOrEqual(4.5);
  }
}

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
  await expect(page.getByText("No OFPs loaded yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load latest OFP", exact: true })).toBeDisabled();
  const cookie = (await context.cookies()).find((item) => item.name.endsWith("session_token"));
  expect(cookie?.value).toBeTruthy();
  await registerSensitive(request, `email-tracker-${identity}`, email);
  await registerSensitive(request, `session-tracker-${identity}`, cookie!.value);
  if (identity === "a") await registerSensitive(request, "pilot-stub", PILOT_ID);
  if (identity === "a") {
    const fix = multiPageFixture.navlog.fix[0];
    await registerSensitive(request, "navlog-latitude-raw", fix.pos_lat);
    await registerSensitive(request, "navlog-longitude-raw", fix.pos_long);
    await registerSensitive(request, "navlog-latitude-number", String(Number(fix.pos_lat)));
    await registerSensitive(request, "navlog-longitude-number", String(Number(fix.pos_long)));
    await registerSensitive(request, "raw-ofp-marker", multiPageFixture.params.time_generated);
  }
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

test("valid fixture Load creates an owned tracker at three viewports", async ({ browser, request }, testInfo) => {
  test.setTimeout(150_000);
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
    await expect(page.locator("li.tracker-row .tracker-ident"))
      .toHaveText(expectedRoute);
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
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expectUsableViewport(page, viewport.width);
      await expect(page.locator("li.tracker-row")).toHaveCount(43);
      await expect(page.locator(".tracker-page-rule")).toHaveCount(5);
      await expectTextContrast(page, [
        { text: ".tracker-eyebrow", surface: "body" },
        { text: ".tracker-row-detail", surface: "body" },
        { text: ".tracker-shell button", surface: ".tracker-shell button" },
      ]);
      await testInfo.attach(`tracker-${viewport.label}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await page.goto("/");
      await expectUsableViewport(page, viewport.width);
      await expect(page.getByRole("region", { name: "Recent OFP loads" })).toBeVisible();
      await expectTextContrast(page, [
        { text: "main h1", surface: "body" },
        { text: "button.bg-amber-300", surface: "button.bg-amber-300" },
        { text: "section[aria-label='Recent OFP loads'] h2", surface: "section[aria-label='Recent OFP loads']" },
      ]);
      await testInfo.attach(`home-${viewport.label}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await page.goto(`/trackers/${trackerId}`);
    }
    await page.goto("/");
    const recent = page.getByRole("region", { name: "Recent OFP loads" });
    const entry = recent.locator(`a[href="/trackers/${trackerId}"]`);
    await expect(entry).toHaveAttribute("href", `/trackers/${trackerId}`);
    await expect(entry).toContainText(utcAviation(row.loaded_at));
    await expect(entry).toContainText(utcAviation(row.generated_at));
    // A second deliberate load in another tab adds a separate instance with
    // matching flight metadata; the first tab refreshes only on navigation.
    await pool.query(
      "UPDATE load_reservation SET accepted_at = clock_timestamp() - interval '31 seconds' WHERE user_id = (SELECT user_id FROM tracker WHERE id = $1)",
      [trackerId],
    );
    const secondPage = await context.newPage();
    await secondPage.goto("/");
    await secondPage.getByRole("button", { name: "Load latest OFP", exact: true }).click();
    await expect(secondPage).toHaveURL(/\/trackers\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    const secondTrackerId = secondPage.url().split("/").at(-1)!;
    expect(secondTrackerId).not.toBe(trackerId);
    await expect(recent.getByRole("link")).toHaveCount(1);
    const fetchesBeforeReopen = await stubCount(request, isolatedSettings().stubUrl);
    await page.reload();
    await expect(recent.getByRole("link")).toHaveCount(2);
    await expect(recent.getByRole("link").first()).toHaveAttribute("href", `/trackers/${secondTrackerId}`);
    await expect(recent.getByRole("link").last()).toHaveAttribute("href", `/trackers/${trackerId}`);
    await entry.click();
    await expect(page).toHaveURL(new RegExp(`/trackers/${trackerId}$`));
    expect(await stubCount(request, isolatedSettings().stubUrl)).toBe(fetchesBeforeReopen);

    // This disposable Journey database temporarily hides only the metadata
    // table to prove a read failure is not mistaken for an empty history.
    await pool.query("ALTER TABLE ofp_load RENAME TO ofp_load_recent_test_hidden");
    try {
      await page.goto("/");
      await expect(recent.getByRole("alert")).toContainText("Recent loads could not be shown");
      await expect(page.getByText("No OFPs loaded yet")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Retry recent loads" })).toBeVisible();
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await expectUsableViewport(page, viewport.width);
        await testInfo.attach(`recent-error-${viewport.label}`, { body: await page.screenshot(), contentType: "image/png" });
      }
    } finally {
      await pool.query("ALTER TABLE ofp_load_recent_test_hidden RENAME TO ofp_load");
    }
    await page.getByRole("button", { name: "Retry recent loads" }).click();
    await expect(recent.getByRole("link")).toHaveCount(2);
    // A fixture with two distinct fixes named REPEAT exercises route identity
    // and layout without shortening the navlog or changing tracker rules.
    await page.getByRole("textbox", { name: "Pilot ID" }).fill("100004");
    await page.getByRole("button", { name: "Save Pilot ID" }).click();
    await expect(page.getByRole("status")).toHaveText("Pilot ID saved.");
    await pool.query(
      "UPDATE load_reservation SET accepted_at = clock_timestamp() - interval '31 seconds' WHERE user_id = (SELECT user_id FROM tracker WHERE id = $1)",
      [trackerId],
    );
    await page.getByRole("button", { name: "Load latest OFP", exact: true }).click();
    await expect(page).toHaveURL(/\/trackers\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    const repeatedCount = await page.locator("li.tracker-row .tracker-ident", { hasText: "REPEAT" }).count();
    expect(repeatedCount).toBeGreaterThan(1);
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expectUsableViewport(page, viewport.width);
      await expect(page.locator("li.tracker-row .tracker-ident", { hasText: "REPEAT" })).toHaveCount(repeatedCount);
    }
    console.log("JOURNEY fixture Load and responsive trackers: pass");
  } finally {
    await context?.close();
    await pool.end();
  }
});

test("Save, single Pass, confirmed cascade and Skip persist after reload", async ({ browser, request }, testInfo) => {
  test.setTimeout(150_000);
  const email = process.env.JOURNEY_TRACKER_EMAIL_B;
  if (!email) throw new Error("Isolated tracker email is required");
  const pool = new Pool({ connectionString: isolatedSettings().databaseUrl });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const loaded = await signInAndLoad(context, request, email, "b");
    const { page, trackerId } = loaded;
    const sid = page.getByRole("button", { name: "SID included" });
    await page.getByRole("button", { name: "STAR included" }).click();
    await expect(page.getByRole("button", { name: "STAR excluded" })).toBeVisible();
    expect((await trackerRow(pool, trackerId, email)).snapshot.procedureInclusion.star).toBe(false);
    await page.reload();
    await expect(page.getByRole("button", { name: "STAR excluded" })).toBeVisible();
    await page.getByRole("button", { name: "STAR excluded" }).click();
    await expect(page.getByRole("button", { name: "STAR included" })).toBeVisible();
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
      await expect(page.getByRole("status")).toContainText("Waypoint saved.");
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
    const invokingPass = page.locator('li.tracker-row[data-state="saved"]').last().getByRole("button", { name: "Pass" });
    await invokingPass.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Pass these waypoints?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expect(dialog).toHaveAttribute("aria-describedby", "cascade-description");
    const beforeCascade = await trackerRow(pool, trackerId, email);
    const savedIndexes = beforeCascade.snapshot.waypoints.filter((fix) => fix.state === "saved").map((fix) => fix.routeIndex);
    const preview = previewPass(beforeCascade.snapshot, savedIndexes.at(-1)!);
    expect(preview.outcome).toBe("selected");
    if (preview.outcome !== "selected") throw new Error("Expected cascade selection");
    await expect(dialog.locator("li")).toHaveText(preview.routeIndexes.map((index) =>
      `${beforeCascade.navlog.points[index].ident} · route position ${index}`));
    const versionBeforeCancel = beforeCascade.version;
    const displayBeforeCancel = await page.locator(".tracker-route-list ol").innerText();
    expect((await trackerRow(pool, trackerId, email)).snapshot.waypoints.filter((point) => point.state === "passed")).toHaveLength(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(invokingPass).toBeFocused();
    expect(await page.locator(".tracker-route-list ol").innerText()).toBe(displayBeforeCancel);
    expect((await trackerRow(pool, trackerId, email)).version).toBe(versionBeforeCancel);
    expect((await trackerRow(pool, trackerId, email)).snapshot.waypoints.filter((point) => point.state === "passed")).toHaveLength(1);
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await invokingPass.click();
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
      await expectUsableViewport(page, viewport.width);
      await testInfo.attach(`cascade-${viewport.label}`, { body: await page.screenshot(), contentType: "image/png" });
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(invokingPass).toBeFocused();
    }
    await invokingPass.click();
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
    const { stubUrl } = isolatedSettings();
    const fetchesBeforeReopen = await stubCount(request, stubUrl);
    const trackerCountBeforeReopen = (await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM tracker')).rows[0].count;
    await page.goto("/");
    await page.getByRole("region", { name: "Recent OFP loads" }).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/trackers/${trackerId}$`));
    await expect(page.locator('li.tracker-row[data-state="passed"]')).toHaveCount(3);
    await expect(page.locator('li.tracker-row[data-state="skipped"]')).toHaveCount(1);
    expect((await trackerRow(pool, trackerId, email)).version).toBeGreaterThan(1);
    expect(await stubCount(request, stubUrl)).toBe(fetchesBeforeReopen);
    expect((await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM tracker')).rows[0].count)
      .toBe(trackerCountBeforeReopen);
    const versionBeforeReopenedSave = (await trackerRow(pool, trackerId, email)).version;
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('li.tracker-row[data-state="saved"]')).toHaveCount(1);
    expect((await trackerRow(pool, trackerId, email)).version).toBe(versionBeforeReopenedSave + 1);
    await page.reload();
    await expect(page.locator('li.tracker-row[data-state="saved"]')).toHaveCount(1);
    console.log("JOURNEY persisted tracker workflow: pass");
  } finally {
    await context?.close();
    await pool.end();
  }
});

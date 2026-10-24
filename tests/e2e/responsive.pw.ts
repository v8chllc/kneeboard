import { expect, test } from "@playwright/test";

const viewports = [
  { label: "phone", width: 390, height: 844, minimumFormWidth: 350 },
  { label: "tablet", width: 768, height: 1024, minimumFormWidth: 500 },
  { label: "desktop", width: 1440, height: 900, minimumFormWidth: 500 },
] as const;

for (const viewport of viewports) {
  test(`responsive sign-in layout at ${viewport.label} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Sign in with a magic link" }) });
    await expect(form).toBeVisible();
    const box = await form.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width, `${viewport.label} form width`).toBeGreaterThanOrEqual(viewport.minimumFormWidth);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}

import { expect, test } from "@playwright/test";

test("built application displays its home page and simulation warning", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "INS waypoint-entry tracking for the home cockpit." })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Simulation-only warning" })).toContainText(
    "For home flight simulation only.",
  );
});

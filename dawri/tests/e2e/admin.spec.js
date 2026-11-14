import { test, expect } from "./fixtures.js";

test("platform dashboard: KPIs, trend, tabs, tips and export", async ({ page }) => {
  await page.goto("/admin");
  await page.click('[data-demo-login="admin@demo.dawri.app"]');
  await expect(page.locator(".kpi.hero")).toContainText("ر.س");
  await expect(page.locator(".adm-trend")).toBeVisible();
  await page.click('[data-tab="customers"]');
  await expect(page.locator(".kpi").first()).toContainText("زبائن");
  await page.click('[data-tab="tips"]');
  await expect(page.getByTestId("admin-tips").locator(".tip").first()).toBeVisible();
  await page.click('[data-tab="shops"]');
  await expect(page.getByTestId("admin-table")).toContainText("حلاق الأصيل");
  await page.fill('[data-testid="admin-search"]', "مقهى");
  await expect(page.getByTestId("admin-table").locator("tbody tr")).toHaveCount(1);
  const dl = page.waitForEvent("download");
  await page.locator(".card", { hasText: "المحلات (" }).getByRole("button", { name: "Excel" }).click();
  expect((await dl).suggestedFilename()).toMatch(/dawri-shops-.*\.csv/);
});

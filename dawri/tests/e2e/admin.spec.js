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

test("admin adds a client with start + duration, edits the type, then deletes it", async ({ page }) => {
  await page.goto("/admin");
  await page.click('[data-demo-login="admin@demo.dawri.app"]');
  await page.click('[data-tab="shops"]');
  await page.getByTestId("add-client").click();
  await page.fill('[data-testid="new-name"]', "صالون الورد");
  await page.fill('[data-testid="new-email"]', "ward@example.com");
  await page.fill('[data-testid="new-pass"]', "temporary-1");
  await page.click('.sub-type [data-status="active"]');
  await page.fill('[data-testid="sub-start"]', "2026-01-31");
  await page.fill('[data-testid="sub-duration"]', "1");
  await page.selectOption('[data-testid="sub-unit"]', "month");
  // 31 Jan + 1 month ends on the last day of February
  await expect(page.getByTestId("sub-end")).toContainText("فبراير");
  await page.click('[data-action="create-client"]');
  const row = page.getByTestId("admin-table").locator("tr", { hasText: "صالون الورد" });
  await expect(row).toContainText("غير نشط"); // ended in February 2026

  await row.getByRole("button", { name: "إدارة" }).click();
  await page.locator(".sheet label.check input").first().uncheck();
  await page.click('.sheet .sub-type [data-status="trial"]');
  await page.fill('[data-testid="sub-start"]', new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10));
  await page.click('[data-action="save-client"]');
  await expect(page.getByTestId("admin-table").locator("tr", { hasText: "صالون الورد" })).toContainText("تجريبي مؤقت");

  await page.getByTestId("admin-table").locator("tr", { hasText: "صالون الورد" }).getByRole("button", { name: "إدارة" }).click();
  await page.getByTestId("delete-client").click();
  await page.fill('[data-testid="confirm-name"]', "صالون الورد");
  await page.click('[data-action="confirm-delete"]');
  await expect(page.getByTestId("admin-table")).not.toContainText("صالون الورد");
});

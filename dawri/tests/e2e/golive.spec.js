import { test, expect } from "./fixtures.js";

test("admin replaces the shared demo login with a private email and password", async ({ page }) => {
  await page.goto("/admin");
  await page.click('[data-demo-login="admin@demo.dawri.app"]');
  await expect(page.getByTestId("shared-login")).toBeVisible();
  await page.getByTestId("shared-login").getByRole("button").click();
  await page.fill('[data-testid="acc-email"]', "owner.private@example.org");
  await page.fill('[data-testid="acc-pass"]', "a-private-pass-1");
  await page.fill('[data-testid="acc-pass2"]', "a-private-pass-1");
  await page.fill('[data-testid="acc-current"]', "wrong-password");
  await page.click('[data-action="save-account"]');
  await expect(page.locator(".sheet .err")).toContainText("كلمة المرور الحالية");
  await page.fill('[data-testid="acc-current"]', "Dawri-Demo-2026");
  await page.click('[data-action="save-account"]');
  await expect(page.getByTestId("shared-login")).toHaveCount(0);
  // the old shared login no longer works, the new one does
  await page.getByRole("button", { name: "خروج" }).click();
  await page.fill('input[type=email]', "admin@demo.dawri.app");
  await page.fill('input[type=password]', "Dawri-Demo-2026");
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page.locator(".err")).toBeVisible();
  await page.fill('input[type=email]', "owner.private@example.org");
  await page.fill('input[type=password]', "a-private-pass-1");
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page.locator(".kpi.hero")).toBeVisible();
});

test("QR kit: admin opens a shop's posters; three designs with the shop link", async ({ page }) => {
  await page.goto("/admin");
  await page.click('[data-demo-login="admin@demo.dawri.app"]');
  await page.click('[data-tab="shops"]');
  const row = page.getByTestId("admin-table").locator("tr", { hasText: "حلاق الأصيل" });
  await expect(row.getByTestId("shop-qr")).toHaveAttribute("href", "./poster/aseel2026");
  await page.goto("/poster/aseel2026");
  for (const d of ["door", "card", "sticker"]) {
    await page.click(`[data-design="${d}"]`);
    await expect(page.locator(`.pk-${d}`)).toContainText("حلاق الأصيل");
    await expect(page.locator(`.pk-${d} .qr-box svg`)).toBeVisible();
  }
  await page.click('[data-design="door"]');
  await expect(page.locator(".pk-door")).toContainText("اختر الخدمة والكرسي");
  await expect(page.locator(".pk-door .pk-url")).toContainText("/s/aseel2026");
});

test("privacy page is linked from the shop page", async ({ page }) => {
  await page.goto("/s/aseel2026?stay");
  await page.getByTestId("privacy-link").click();
  await expect(page.locator("h2").first()).toContainText("خصوصيتك");
  await expect(page.locator("body")).toContainText("٩٠ يوماً");
});

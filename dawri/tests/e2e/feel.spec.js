import { test, expect, ownerLogin } from "./fixtures.js";

test("«اكتب لي بإحساس»: one item from the edit sheet, then every item without a description", async ({ page }) => {
  await ownerLogin(page, "barber@demo.dawri.app");
  await page.goto("/owner/settings");
  const menu = page.locator(".card", { hasText: "قائمتي" });
  // one item: the owner's note goes with it, the line lands in the description box
  await menu.locator(".list-item", { hasText: "تنظيف بشرة" }).getByRole("button", { name: "تعديل" }).click();
  await page.locator("#item-desc").waitFor();
  await page.fill("#item-note", "نستخدم مناشف ساخنة");
  await expect(page.locator("#item-note")).toHaveValue("نستخدم مناشف ساخنة");
  await page.getByTestId("write-feel").click();
  await expect(page.locator("#item-desc")).toHaveValue(/مناشف ساخنة/);
  await expect(page.getByTestId("write-feel")).toContainText("اكتب غيرها");
  await page.getByRole("dialog").getByRole("button", { name: "احفظ", exact: true }).click();
  await expect(menu.locator(".list-item", { hasText: "تنظيف بشرة" }).locator(".feel-line")).toBeVisible();

  // the rest in one go, reviewed before saving
  await page.getByTestId("describe-all").click();
  await expect(page.getByTestId("feel-rows").locator("textarea").first()).not.toHaveValue("");
  await page.getByRole("button", { name: "احفظ الأوصاف" }).click();
  await expect(page.getByTestId("describe-all")).toHaveCount(0);
});

test("owner sees who did what in the queue log", async ({ page, context }) => {
  const staff = await context.newPage();
  await staff.goto("/staff/pair#demo-staff-aseel-chair1-000000000000");
  await staff.getByTestId("call-next").click();
  await ownerLogin(page, "barber@demo.dawri.app");
  await page.goto("/owner/settings");
  await page.getByTestId("audit-log").click();
  await expect(page.getByTestId("audit-rows")).toContainText("تم النداء");
  await expect(page.getByTestId("audit-rows")).toContainText("كرسي ١");
});

test("renaming a menu item linked to a queue service shows on the shop page", async ({ page, context }) => {
  await ownerLogin(page, "barber@demo.dawri.app");
  await page.goto("/owner/settings");
  const menu = page.locator(".card").filter({ has: page.locator(".card-head", { hasText: "قائمتي" }) });
  await menu.locator(".list-item", { hasText: "حلاقة ذقن" }).getByRole("button", { name: "تعديل" }).click();
  await expect(page.getByRole("dialog")).toContainText("مرتبط بخدمة في الطابور");
  await page.getByRole("dialog").locator("input").first().fill("حلاقة دقن");
  await page.getByRole("dialog").getByRole("button", { name: "احفظ", exact: true }).click();
  const shop = await context.newPage();
  await shop.goto("/s/aseel2026?stay");
  await expect(shop.locator('[data-testid="take-number"]').first()).toBeVisible();
  await expect(shop.locator("[data-service]", { hasText: "حلاقة دقن" })).toHaveCount(1);
  await expect(shop.locator("[data-service]", { hasText: "حلاقة ذقن" })).toHaveCount(0);
});

import { test, expect, ownerLogin } from "./fixtures.js";

test("remote: join → called → done → feedback", async ({ page, context }) => {
  await page.goto("/s/aseel2026");
  await page.locator('[data-service="d0000000-0000-4000-8000-000000000022"], [data-service="svc-beard"]').getByTestId("take-number").click();
  await page.click('[data-action="join-confirm"]');
  await page.waitForURL(/\/t\//);
  const number = (await page.locator(".t-number").innerText()).trim().replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  await expect(page.locator(".t-status")).toContainText(/أمامك|أنت التالي/);

  const staff = await context.newPage();
  await staff.goto("/staff/pair#demo-staff-aseel-chair1-000000000000");
  await staff.waitForURL(/\/staff$/);
  await staff.locator(`[data-ticket="${number}"]`).click();
  await staff.getByRole("button", { name: "نادِ هذا الرقم" }).click();

  await expect(page.getByTestId("called-overlay")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("called-overlay")).toContainText("حان دورك");
  await page.getByTestId("called-overlay").getByRole("button").click();

  await staff.getByTestId("done").click();
  await expect(page.getByTestId("feedback-card")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("fb-up").click();
  await expect(page.getByTestId("google-review")).toBeVisible();
  await expect(page.getByTestId("loyalty-prompt")).toBeVisible();
});

test("receipt: scan → kitchen marks ready → customer sees it", async ({ page, context }) => {
  await page.goto("/s/rukn2026?stay");
  await page.getByTestId("track-order").click();
  await page.fill("#receipt-code", "88");
  await page.click('[data-action="receipt-confirm"]');
  await page.waitForURL(/\/t\//);
  await expect(page.locator(".t-status")).toHaveText("قيد التحضير");

  const kitchen = await context.newPage();
  await kitchen.goto("/staff/pair#demo-staff-rukn-kitchen-000000000000");
  for (const d of "88") await kitchen.locator(".keypad button", { hasText: d }).first().click();
  await kitchen.getByRole("button", { name: "جاهز" }).click();

  await expect(page.getByTestId("called-overlay")).toContainText("طلبك جاهز", { timeout: 15000 });
});

test("dropoff: register → claim link → stage changes", async ({ page, context }) => {
  const staff = await context.newPage();
  await staff.goto("/staff/pair#demo-staff-lamaa-front-0000000000000");
  await staff.getByTestId("dropoff-new").click();
  await staff.fill("#dropoff-label", "سوناتا رمادية ٧٧٧");
  await staff.click('[data-action="dropoff-create"]');
  const url = (await staff.getByTestId("claim-url").innerText()).trim();
  await staff.keyboard.press("Escape");

  await page.goto(new URL(url).pathname);
  await page.waitForURL(/\/t\//);
  await expect(page.locator(".stages .current")).toHaveText("استلمنا");

  const row = staff.locator(".staff-ticket", { hasText: "سوناتا رمادية" });
  await row.getByRole("button").click();
  await expect(page.locator(".stages .current")).toHaveText("قيد العمل", { timeout: 15000 });
  await row.getByRole("button").click();
  await expect(page.getByTestId("called-overlay")).toContainText("جاهزة للاستلام", { timeout: 15000 });
});

test("staff screen in Urdu renders right-to-left", async ({ page }) => {
  await page.goto("/staff/pair#demo-staff-aseel-chair2-000000000000");
  await expect(page.getByTestId("call-next")).toContainText("اگلے کو بلائیں");
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("ur");
});

test("staff screen in Bengali renders left-to-right", async ({ page }) => {
  await page.goto("/staff/pair#demo-staff-lamaa-front-0000000000000");
  await expect(page.getByTestId("dropoff-new")).toContainText("নতুন জমা");
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("ltr");
});

test("owner dashboard shows lost customers in SAR", async ({ page }) => {
  await ownerLogin(page, "barber@demo.dawri.app");
  await expect(page.getByTestId("lost-sar")).toContainText("ريال");
  await page.goto("/owner/pulse");
  await expect(page.getByTestId("pulse-lost")).toContainText("ريال");
  await expect(page.getByTestId("absent-list")).toBeVisible();
});

test("locked features show a lock card with the required plan", async ({ page }) => {
  await ownerLogin(page, "wash@demo.dawri.app");
  await page.goto("/owner/offers");
  await expect(page.locator(".card.locked").first()).toContainText("متاحة في");
  await expect(page.locator(".card.locked", { hasText: "العروض حسب الوقت" })).toContainText("باقة النمو");
  await expect(page.getByTestId("add-offer")).toHaveCount(0);
});

test("unpaired staff device sees the pairing message", async ({ page }) => {
  await page.goto("/staff");
  await expect(page.getByText("الجهاز غير مربوط")).toBeVisible();
});

test("customer can switch to dark mode from the shop page and it is remembered", async ({ page }) => {
  await page.goto("/s/aseel2026?stay");
  const toggle = page.getByTestId("theme-toggle");
  await expect(toggle).toHaveAttribute("aria-label", "الوضع الداكن");
  await toggle.click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe("rgb(228, 233, 227)");
  await expect(toggle).toHaveAttribute("aria-label", "الوضع الفاتح");
  await page.getByTestId("take-number").first().click();
  await page.click('[data-action="join-confirm"]');
  await page.waitForURL(/\/t\//);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await page.getByTestId("theme-toggle").click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
});

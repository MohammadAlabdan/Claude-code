import { test, expect, ownerLogin } from "./fixtures.js";

const digits = (s) => s.trim().replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

test("waiting showcase: start a challenge, ask for an extra, the visit counts when done", async ({ page, context }) => {
  await page.goto("/s/aseel2026?stay");
  await expect(page.getByTestId("shop-quests")).toContainText("تحدّي العصر الهادئ");
  await page.getByTestId("take-number").first().click();
  await page.click('[data-action="join-confirm"]');
  await page.waitForURL(/\/t\//);
  const number = digits(await page.locator(".t-number").innerText());

  const showcase = page.getByTestId("waiting-showcase");
  await expect(showcase).toBeVisible();
  // a fixed list, never more than 4 surprises; the first one is sealed until tapped
  expect(await showcase.locator(".gift").count()).toBeLessThanOrEqual(4);
  await showcase.getByTestId("gift-reveal").click();
  await expect(showcase.getByTestId("gift-reveal")).toHaveCount(0);
  // the «ثلاث حلاقات» challenge counts haircuts, which this ticket is
  const card = showcase.locator(".gift", { hasText: "ثلاث حلاقات" });
  await card.getByTestId("quest-start").click();
  await page.fill("#quest-phone", "0559998877");
  await page.check("#quest-consent");
  await page.click('[data-action="quest-confirm"]');
  await expect(showcase.locator(".gift", { hasText: "ثلاث حلاقات" })).toContainText("باقي");

  const item = showcase.locator(".extra", { hasText: "تنظيف بشرة" });
  await item.getByTestId("want-item").click();
  await expect(showcase.locator(".extra", { hasText: "تنظيف بشرة" })).toContainText("طلبتها");

  const staff = await context.newPage();
  await staff.goto("/staff/pair#demo-staff-aseel-chair1-000000000000");
  const row = staff.locator(`[data-ticket="${number}"]`);
  await expect(row.getByTestId("staff-want")).toContainText("تنظيف بشرة");
  await row.click();
  await staff.getByRole("button", { name: "نادِ هذا الرقم" }).click();
  await page.getByTestId("called-overlay").getByRole("button").click();
  await staff.getByTestId("done").click();

  // after the visit: the challenge shows one of three stops done
  await expect(page.locator(".quest", { hasText: "ثلاث حلاقات" }).locator(".q-stop.on")).toHaveCount(1, { timeout: 15000 });
});

test("owner designs a challenge from a suggestion and customers see it", async ({ page }) => {
  await ownerLogin(page, "barber@demo.dawri.app");
  await page.goto("/owner/offers");
  await expect(page.getByTestId("owner-quests")).toBeVisible();
  await page.getByTestId("new-quest").click();
  await page.fill("#quest-title", "تحدّي الاختبار");
  await expect(page.getByTestId("quest-preview")).toContainText("تحدّي الاختبار");
  await page.click('[data-action="quest-save"]');
  await expect(page.getByTestId("owner-quests")).toContainText("تحدّي الاختبار");
  await page.goto("/s/aseel2026?stay");
  await expect(page.getByTestId("shop-quests")).toContainText("تحدّي الاختبار");
});

test("basic plan: challenges are a locked card", async ({ page }) => {
  await ownerLogin(page, "wash@demo.dawri.app");
  await page.goto("/owner/offers");
  await expect(page.locator(".card.locked", { hasText: "تحدّياتي" })).toContainText("باقة النمو");
});

test("café: an extra requested while waiting shows on the kitchen screen", async ({ page, context }) => {
  await page.goto("/s/rukn2026?stay");
  await page.getByTestId("track-order").click();
  await page.fill("#receipt-code", "61");
  await page.click('[data-action="receipt-confirm"]');
  await page.waitForURL(/\/t\//);
  const item = page.getByTestId("waiting-showcase").locator(".extra", { hasText: "كيكة تمر" });
  await item.getByTestId("want-item").click();
  await expect(page.getByTestId("waiting-showcase").locator(".extra", { hasText: "كيكة تمر" })).toContainText("طلبتها");
  const kitchen = await context.newPage();
  await kitchen.goto("/staff/pair#demo-staff-rukn-kitchen-000000000000");
  await expect(kitchen.locator(".chip", { hasText: "٦١" }).getByTestId("staff-want")).toContainText("كيكة تمر");
});

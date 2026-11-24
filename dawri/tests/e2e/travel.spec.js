import { test, expect } from "./fixtures.js";

test("customer says how far they are, sees when to leave, taps «وصلت», and the staff screen shows it", async ({ page, context }) => {
  await page.goto("/s/aseel2026?stay");
  await page.getByTestId("take-number").first().click();
  await page.click('[data-action="join-confirm"]');
  await page.waitForURL(/\/t\//);
  const card = page.getByTestId("travel-card");
  await expect(card).toBeVisible();
  // a barber offers 5 / 15 / 30 / 45 minutes and «أنا قريب»
  await expect(card.locator("[data-travel]")).toHaveCount(5);
  await expect(page.getByTestId("turn-at")).toBeVisible();
  await card.locator('[data-travel="15"]').click();
  await expect(card.locator('[data-travel="15"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("leave-at")).toBeVisible();
  const number = (await page.locator(".t-number").innerText()).trim();

  await page.getByTestId("arrived").click();
  await expect(page.getByTestId("arrived-on")).toBeVisible();
  await expect(page.getByTestId("travel-card")).toHaveCount(0);

  const staff = await context.newPage();
  await staff.goto("/staff/pair#demo-staff-aseel-chair1-000000000000");
  const row = staff.locator(".staff-ticket", { has: staff.locator(".n", { hasText: number }) });
  await expect(row.getByTestId("staff-arrived")).toBeVisible();
});

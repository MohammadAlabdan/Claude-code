import { test, expect } from "./fixtures.js";

test("chairs board: see who is busy or free, book a specific chair, the ticket says which", async ({ page, context }) => {
  // chair 1's device calls someone, so chair 1 is busy
  const staff = await context.newPage();
  await staff.goto("/staff/pair#demo-staff-aseel-chair1-000000000000");
  await staff.getByTestId("call-next").click();

  await page.goto("/s/aseel2026?stay");
  const board = page.getByTestId("chairs-board");
  await expect(board).toContainText("الكراسي الحين");
  await expect(board.locator(".chair[data-chair]")).toHaveCount(3);
  await expect(board.locator(".chair", { hasText: "كرسي ١" })).toContainText("مشغول");
  await expect(board.locator(".chair", { hasText: "كرسي ٣" })).toContainText("فاضي");

  // book chair 3 for a beard trim
  await board.locator(".chair", { hasText: "كرسي ٣" }).getByTestId("book-chair").click();
  await page.locator("[data-pick-service]", { hasText: "حلاقة ذقن" }).click();
  await expect(page.locator('.chair-chip[aria-pressed="true"]')).toContainText("كرسي ٣");
  await page.click('[data-action="join-confirm"]');
  await page.waitForURL(/\/t\//);
  await expect(page.locator("main")).toContainText("كرسي ٣");
});

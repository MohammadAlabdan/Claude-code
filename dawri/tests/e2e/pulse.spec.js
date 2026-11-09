import { test, expect } from "./fixtures.js";

const digits = (s) => Number(s.trim().replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)));

test("shop pulse: live crowd, «نبّهني لما تهدأ» fires once the line gets short", async ({ page, context }) => {
  await context.grantPermissions(["notifications"]);
  const staff = await context.newPage();
  await staff.goto("/staff/pair#demo-staff-aseel-chair1-000000000000");
  for (let i = 0; i < 4; i++) {
    await staff.getByTestId("add-walkin").click();
    await staff.click('[data-action="walkin-confirm"]');
    await staff.getByTestId("walkin-number").waitFor();
    await staff.getByRole("button", { name: "تمام" }).click();
  }

  await page.goto("/s/aseel2026?stay");
  const pulse = page.getByTestId("shop-header");
  await expect(pulse).toHaveClass(/lv-(some|busy)/);
  const waiting = digits(await page.getByTestId("fadeet-line").locator("b").innerText());
  expect(waiting).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId("pulse-join")).toBeVisible();

  await page.getByTestId("quiet-watch").click();
  await page.locator(".chip", { hasText: "٢ أو أقل" }).click();
  await page.click('[data-action="quiet-confirm"]');
  await expect(page.getByTestId("quiet-watching")).toContainText("٢");

  // staff serves people until 2 are left: the watch fires once and disappears
  for (let i = 0; i < waiting - 3; i++) {
    await staff.getByTestId("call-next").click();
    await staff.getByTestId("done").click();
  }
  await expect(page.getByTestId("quiet-watching")).toBeVisible();
  for (let i = 0; i < 1; i++) {
    await staff.getByTestId("call-next").click();
    await staff.getByTestId("done").click();
  }
  await expect(page.getByTestId("quiet-watching")).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("هدأت الزحمة");
});

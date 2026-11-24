import { test, expect } from "./fixtures.js";

test("customer links WhatsApp from the ticket page (demo simulates the message)", async ({ page }) => {
  await page.goto("/s/aseel2026?stay");
  await page.getByTestId("take-number").first().click();
  await page.click('[data-action="join-confirm"]');
  await page.waitForURL(/\/t\//);
  const card = page.getByTestId("wa-card");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("wa-link")).toHaveAttribute("href", /^https:\/\/wa\.me\/966500000000\?text=.*J[A-Z0-9]{6}/);
  await page.getByTestId("wa-link").click();
  await expect(page.locator(".wa-preview")).toContainText("رمز التذكرة");
  await page.click('[data-action="wa-demo-link"]');
  await expect(page.getByTestId("wa-on")).toBeVisible();
  await expect(card).toHaveCount(0);
});

test("admin saves WhatsApp settings: a 05 number becomes +966, keys stay hidden", async ({ page }) => {
  await page.goto("/admin");
  await page.click('[data-demo-login="admin@demo.dawri.app"]');
  await page.getByTestId("wa-settings").click();
  await page.fill("#wa-number", "0551234567");
  await page.fill("#wa-pid", "123456789012");
  await page.fill("#wa-token", "EAAG-test-token");
  await page.fill("#wa-secret", "test-secret");
  await page.check("#wa-enabled");
  await page.click('[data-action="wa-save"]');
  const box = page.locator(".card", { hasText: "تنبيهات واتساب" });
  await expect(box).toContainText("+966551234567");
  await expect(box).toContainText("مفعّل");
  await page.getByTestId("wa-settings").click();
  await expect(page.locator("#wa-token")).toHaveValue("");
  await expect(page.locator("#wa-token")).toHaveAttribute("placeholder", /محفوظ/);
});

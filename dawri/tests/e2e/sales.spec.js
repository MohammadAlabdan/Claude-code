import { test, expect, ownerLogin } from "./fixtures.js";

test("quote → customer accepts → agreement → invoice", async ({ page, context }) => {
  // 1) the admin builds a quote: featured plan, yearly, plus setup
  await page.goto("/admin");
  await page.click('[data-demo-login="admin@demo.dawri.app"]');
  await page.click('[data-tab="sales"]');
  await page.getByTestId("new-quote").click();
  const studio = page.getByTestId("quote-studio");
  await expect(studio).toBeVisible();
  await studio.getByTestId("q-customer").fill("حلاق النخبة");
  await studio.locator("#q-contact_name").fill("سالم");
  await studio.locator('[data-cycle="year"]').click();
  await studio.locator('[data-addon="setup"]').click();
  // growth 399 × (12 − 2 free months) + setup 399
  await expect(studio.getByTestId("quote-total")).toHaveText("4,389.00 ر.س");
  await expect(studio.locator(".paper .p-totals .grand")).toContainText("4,389.00");
  await studio.locator('[data-action="q-save-send"]').click();
  const link = (await page.getByTestId("quote-link").innerText()).trim();
  expect(link).toMatch(/\/q\/[0-9a-f]{36}$/);

  // 2) the customer opens the link and accepts
  const customer = await context.newPage();
  await customer.goto(new URL(link).pathname);
  await expect(customer.getByTestId("quote-page")).toContainText("حلاق النخبة");
  await expect(customer.getByTestId("qp-total")).toHaveText("4,389.00");
  await customer.getByTestId("accept-quote").click();
  await customer.fill("#accept-name", "سالم العتيبي");
  await customer.check("#accept-ok");
  await customer.click('[data-action="accept-confirm"]');
  await expect(customer.getByTestId("quote-accepted")).toBeVisible();
  await expect(customer.getByTestId("quote-signup")).toHaveAttribute("href", /start\?quote=[0-9a-f]{36}/);

  // the admin sees it accepted
  await page.locator(".sheet-backdrop").click().catch(() => {});
  await page.reload();
  await page.click('[data-tab="sales"]');
  await expect(page.locator('[data-quote]').first().locator('[data-status]')).toHaveText("مقبول");

  // 3) the admin issues a paid invoice for that shop; it shows to the owner
  await page.click('[data-sales="invoices"]');
  await page.getByTestId("new-invoice").click();
  const inv = page.getByTestId("invoice-studio");
  await inv.locator("#inv-business").selectOption({ label: "حلاق الأصيل" });
  await inv.locator('[data-action="inv-issue"]').click();
  await expect(page.locator("[data-invoice]").first()).toContainText("مدفوعة");
  // 4) an owner accepts the agreement from the home banner
  // the demo keeps one session per browser: sign the admin out, sign the owner in
  await page.evaluate(() => localStorage.removeItem("dawri.demo.session"));
  const owner = await context.newPage();
  await ownerLogin(owner, "barber@demo.dawri.app");
  await owner.getByTestId("open-contract").click();
  await expect(owner.locator(".contract-read")).toContainText("حلاق الأصيل");
  await owner.fill("#contract-name", "أبو سعد");
  await owner.check("#contract-ok");
  await owner.click('[data-action="contract-accept"]');
  await expect(owner.getByTestId("contract-banner")).toHaveCount(0);

  await owner.goto("/owner/settings");
  await expect(owner.locator("[data-invoice]").first()).toBeVisible();
  await expect(owner.getByTestId("my-contract")).toBeVisible();
});

test("admin edits a price and the business details; IBAN is checked", async ({ page }) => {
  await page.goto("/admin");
  await page.click('[data-demo-login="admin@demo.dawri.app"]');
  await page.click('[data-tab="sales"]');
  await page.click('[data-sales="products"]');
  await page.locator('[data-product="basic"] button').click();
  await page.fill("#p-price", "249");
  await page.click('[data-action="p-save"]');
  await expect(page.locator('[data-product="basic"] .prod-price')).toContainText("249");
  await page.click('[data-sales="settings"]');
  await page.fill("#s-iban", "SA12");
  await page.getByTestId("save-billing-settings").click();
  await expect(page.locator(".toast")).toContainText("الآيبان");
  await page.fill("#s-iban", "SA0380000000608010167519");
  await page.fill("#s-seller_legal_name", "محمد العبدان");
  await page.getByTestId("save-billing-settings").click();
  await expect(page.locator(".toast")).toContainText("حُفظت");
});

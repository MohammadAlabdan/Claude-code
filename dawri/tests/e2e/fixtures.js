import { test as base, expect } from "@playwright/test";
import { mirrorCdn } from "./cdn.js";

// Every page: CDN mirror and demo timers off.
export const test = base.extend({
  context: async ({ context }, use) => {
    // Each test gets a new context, so storage starts empty; tabs inside it share the demo state.
    await context.addInitScript(() => localStorage.setItem("dawri.demo.auto", "false"));
    context.on("page", (p) => mirrorCdn(p));
    await use(context);
  },
  page: async ({ page }, use) => { await mirrorCdn(page); await use(page); },
});
export { expect };

export async function ownerLogin(page, email) {
  await page.goto("/owner");
  await page.click(`[data-demo-login="${email}"]`);
  await expect(page.locator(".tabbar")).toBeVisible();
}

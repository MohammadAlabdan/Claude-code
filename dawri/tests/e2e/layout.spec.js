import { test, expect, ownerLogin } from "./fixtures.js";

const PUBLIC = ["/", "/s/aseel2026?stay", "/s/rukn2026?stay", "/s/lamaa2026?stay", "/staff/pair#demo-staff-aseel-chair1-000000000000",
  "/staff/pair#demo-staff-rukn-kitchen-000000000000", "/staff/pair#demo-staff-lamaa-front-0000000000000", "/start", "/admin", "/dev/ui", "/nope"];
const OWNER = ["/owner", "/owner/queue", "/owner/offers", "/owner/pulse", "/owner/settings", "/owner/poster"];

test("no horizontal scroll at 360 px on any route", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const check = async (path) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(w, `${path} scrollWidth`).toBeLessThanOrEqual(360);
  };
  for (const p of PUBLIC) await check(p);
  // the ticket page
  await page.goto("/s/aseel2026?stay");
  await page.getByTestId("take-number").first().click();
  await page.click('[data-action="join-confirm"]');
  await page.waitForURL(/\/t\//);
  await check(new URL(page.url()).pathname);
  await ownerLogin(page, "barber@demo.dawri.app");
  for (const p of OWNER) await check(p);
});

test("screenshots of the main screens, light and dark, 390×844", async ({ browser }) => {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, serviceWorkers: "block", baseURL: "http://localhost:8899" });
    await ctx.addInitScript(() => localStorage.setItem("dawri.demo.auto", "false"));
    const page = await ctx.newPage();
    const { mirrorCdn } = await import("./cdn.js");
    await mirrorCdn(page);
    const snap = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `screenshots/${name}-${scheme}.png` }); };
    await page.goto("/s/aseel2026?stay"); await snap("shop");
    await page.getByTestId("take-number").first().click();
    await page.click('[data-action="join-confirm"]');
    await page.waitForURL(/\/t\//); await snap("ticket");
    await page.goto("/staff/pair#demo-staff-aseel-chair1-000000000000"); await page.waitForURL(/\/staff$/); await snap("staff");
    await page.goto("/staff/pair#demo-staff-rukn-kitchen-000000000000"); await page.waitForURL(/\/staff$/); await snap("staff-kitchen");
    await page.goto("/owner"); await page.click('[data-demo-login="barber@demo.dawri.app"]'); await page.waitForSelector(".tabbar"); await snap("owner-home");
    await page.goto("/owner/pulse"); await snap("owner-pulse");
    await page.goto("/start"); await snap("onboarding");
    await page.goto("/dev/ui"); await snap("components");
    await ctx.close();
  }
});

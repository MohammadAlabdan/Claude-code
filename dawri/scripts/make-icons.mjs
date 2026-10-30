// Renders web/assets/logo.svg to the PWA icons (192, 512, maskable 512) with Playwright's Chromium.
// Run: node scripts/make-icons.mjs
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../web/", import.meta.url));
const svg = await readFile(root + "assets/logo.svg", "utf8");
await mkdir(root + "assets/icons", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const render = async (size, { pad, bg }) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div></body></html>`);
  return page.screenshot({ omitBackground: bg === "transparent", type: "png" });
};
await writeFile(root + "assets/icons/icon-192.png", await render(192, { pad: 8, bg: "#F3F5F1" }));
await writeFile(root + "assets/icons/icon-512.png", await render(512, { pad: 20, bg: "#F3F5F1" }));
// maskable: logo inside the 80% safe zone on the brand paper colour
await writeFile(root + "assets/icons/maskable-512.png", await render(512, { pad: 72, bg: "#D4F1E6" }));
await browser.close();
console.log("icons written to web/assets/icons/");

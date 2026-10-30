// E2E tests run against the static site in demo mode (no backend needed).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:8899", viewport: { width: 390, height: 844 }, locale: "ar-SA", serviceWorkers: "block" },
  webServer: { command: "node scripts/serve-web.mjs 8899", port: 8899, reuseExistingServer: true },
});

import { defineConfig, devices } from "@playwright/test";

/**
 * PLAYWRIGHT_BASE_URL points the suite at an already-running server; without it the config
 * builds and starts one (as CI does).
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const external = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  /**
   * 60s rather than 30s: several tests sweep every route so one listener spans the whole
   * crawl (the off-origin-request check depends on it). Raise this rather than splitting them.
   */
  timeout: 60_000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(external
    ? {}
    : {
        webServer: {
          // The sweeps would trip the crawl guard's per-address throttle, so it is disabled.
          command: "npm run build && CRAWL_GUARD_DISABLED=1 npm start",
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      }),
});

import { defineConfig, devices } from "@playwright/test";

// By default the tests build the app and run against `vp preview`.
// Set E2E_BASE_URL to test something already running, e.g. the Docker image
// (which also exercises nginx and its Content-Security-Policy).
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: external ?? "http://localhost:4173",
    viewport: { width: 1280, height: 720 },
    // The app honours this by fading instead of sliding, which keeps tests quick and stable.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // E2E_CHANNEL=chrome uses an installed Chrome instead of Playwright's download.
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        channel: process.env.E2E_CHANNEL,
      },
    },
  ],
  webServer: external
    ? undefined
    : {
        command: "npm run build && npm run preview -- --port 4173 --strictPort",
        url: "http://localhost:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});

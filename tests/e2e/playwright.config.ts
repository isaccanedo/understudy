import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://host.docker.internal:39100";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  testIgnore: /demo\//,
  timeout: 8 * 60 * 1000,
  expect: { timeout: 60 * 1000 },
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "report" }]],
  outputDir: "results",
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: { args: ["--host-resolver-rules=MAP host.docker.internal 127.0.0.1"] },
  },
});

import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://host.docker.internal:39100";

export default defineConfig({
  testDir: "demo",
  testMatch: /.*\.spec\.ts$/,
  timeout: 20 * 60 * 1000,
  expect: { timeout: 60 * 1000 },
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  outputDir: "demo-results",
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    launchOptions: { slowMo: 90, args: ["--host-resolver-rules=MAP host.docker.internal 127.0.0.1"] },
  },
});

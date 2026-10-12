/**
 * Real-browser checks of the built page (test/browser/*.spec.ts): the world drawn in a sandboxed frame under the web
 * runner's CSP, the same ground in every engine, building with the mouse, and two sides building in one world and
 * finding it again after a reload. Run `npm run build` first; `npm run test:browser` does both.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/browser",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Locally, at most JOBS workers (default 2), as for Vitest.
  workers: process.env.CI ? undefined : Math.max(1, Number(process.env.JOBS) || 2),
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  timeout: 90_000,
  use: { trace: "retain-on-failure" },
  projects: [
    // SwiftShader: WebGL without a GPU, so CI machines draw the world too.
    { name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});

import { defineConfig } from '@playwright/test';
const browserOptions = browserName => ({ browserName, ...(process.env.CI && browserName === 'firefox'
  ? { launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled':true } } } : {}) });
export default defineConfig({
  testDir: './test', testMatch: '**/*.spec.mjs', timeout: 45000,
  fullyParallel: false, workers: 1,
  use: { headless: !process.env.CI, baseURL: 'http://127.0.0.1:8788', viewport: { width: 1280, height: 800 }, screenshot: 'only-on-failure' },
  projects: ['chromium', 'firefox', 'webkit'].flatMap(browserName => [
    { name: browserName + '-desktop', use: { ...browserOptions(browserName) } },
    { name: browserName + '-mobile-2x', use: { ...browserOptions(browserName), viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true } },
  ]),
  webServer: { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:8788', reuseExistingServer: true },
});

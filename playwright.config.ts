import { defineConfig, devices } from '@playwright/test';
const dataDir = `/private/tmp/steady-browser-tests-${Date.now()}`;
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1,
  timeout: 45000, expect: { timeout: 7000 },
  use: { baseURL: 'http://localhost:4175', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 1080 } } }],
  metadata: { dataDir },
  webServer: { command: 'node server/local.mjs', url: 'http://localhost:4175', env: { PORT: '4175', STEADY_DATA_DIR: dataDir }, reuseExistingServer: false, timeout: 30000 },
});

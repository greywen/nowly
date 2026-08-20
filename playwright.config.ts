import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true
  },
  use: {
    baseURL: 'http://localhost:1420',
    // The UI follows the system language and the specs assert Chinese copy, so
    // pin the browser locale to zh-CN; otherwise Playwright reports en-US and
    // the app renders English, breaking every text-based assertion.
    locale: 'zh-CN',
    ...devices['Desktop Chrome']
  },
  projects: [
    { name: '1366x768', use: { viewport: { width: 1366, height: 768 } } },
    { name: '1920x1080', use: { viewport: { width: 1920, height: 1080 } } },
    { name: '2560x1440', use: { viewport: { width: 2560, height: 1440 } } },
    { name: '5120x1440', use: { viewport: { width: 5120, height: 1440 } } }
  ]
});

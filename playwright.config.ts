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
    ...devices['Desktop Chrome']
  },
  projects: [
    { name: '1366x768', use: { viewport: { width: 1366, height: 768 } } },
    { name: '1920x1080', use: { viewport: { width: 1920, height: 1080 } } }
  ]
});

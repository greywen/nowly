import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../tests',
  testMatch: 'website.spec.ts',
  outputDir: './test-results',
  webServer: {
    command: 'npm run site:build && npm run site:preview',
    cwd: '..',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false
  },
  use: { baseURL: 'http://127.0.0.1:4174', browserName: 'chromium' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1366, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } }
  ]
});

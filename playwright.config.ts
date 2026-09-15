import { defineConfig, devices } from '@playwright/test';

const runtimeEnv = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> }
}).process?.env ?? {};
const testPort = runtimeEnv.PW_PORT ?? '1420';
const reuseExistingServer = runtimeEnv.PW_REUSE_SERVER === 'true';

export default defineConfig({
  testDir: './tests',
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${testPort}`,
    url: `http://127.0.0.1:${testPort}`,
    reuseExistingServer
  },
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
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

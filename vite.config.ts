import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// The app version is the single source of truth in package.json. Inject it as a
// compile-time constant so the browser dev shim (and any non-Tauri build) can
// report it without a backend. The desktop app reads its own version from Cargo
// through the `check_for_update` command instead.
const appVersion = pkg.version;

// The `mode` is `test` only while Vitest runs. Vitest pre-bundles React's CJS
// entry and inlines `process.env.NODE_ENV`; left to the default it resolves to
// "production", so `react/index.js` loads the production build where
// `React.act` is undefined. Testing Library then falls back to the deprecated
// `react-dom/test-utils.act`, which calls the missing `React.act` and throws.
// Pinning the value to a non-production string forces the development build
// that exports `act`. Scoped to the test mode so the production `vite build`
// keeps its own NODE_ENV.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    ...(mode === 'test' ? { 'process.env.NODE_ENV': '"test"' } : {})
  },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true
  },
  server: {
    port: 1420,
    strictPort: true
  }
}));

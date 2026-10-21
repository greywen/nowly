/// <reference types="vite/client" />

// Injected at build time from package.json by vite.config.ts.
declare const __APP_VERSION__: string;

interface Window {
  readonly __NOWLY_SYSTEM_LANGUAGE__?: string | null;
}

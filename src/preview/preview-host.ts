import type { ModuleHost, ModuleFetchOptions, ModuleFetchResponse } from '../widgets/extension-module';

// An in-memory ModuleHost for the preview workbench. It speaks the exact same
// contract as the real (Tauri-backed) host, so a module that runs here runs
// unchanged in the desktop app. State lives in a Map for the page's lifetime —
// drafts are throwaway, so there is no persistence, which also means every
// reload starts a module from a clean slate.
//
// Unlike the desktop host, `fetch` here goes straight through the browser's
// real `fetch` (no Rust SSRF proxy). The preview page runs in an ordinary
// browser tab the author controls, so this is acceptable for development; the
// allow-list is still honored so behavior matches production as closely as
// possible.

export function createPreviewHost(options: {
  moduleId: string;
  todayIso: string;
  allowedHosts?: string[];
  // Seed state, e.g. to preview a module in a known state.
  initialState?: unknown;
}): ModuleHost {
  const allowedHosts = options.allowedHosts ?? [];
  let state: unknown = options.initialState ?? null;

  const host: ModuleHost = {
    moduleId: options.moduleId,
    todayIso: options.todayIso,
    async loadState<T>(): Promise<T | null> {
      return (state as T | null) ?? null;
    },
    async saveState<T>(value: T): Promise<void> {
      // Round-trip through JSON so the preview enforces the same
      // "must be serializable" rule the real host does.
      state = JSON.parse(JSON.stringify(value));
    }
  };

  if (allowedHosts.length > 0) {
    host.fetch = async (url: string, opts?: ModuleFetchOptions): Promise<ModuleFetchResponse> => {
      const response = await fetch(url, {
        method: opts?.method ?? 'GET',
        headers: opts?.headers,
        body: opts?.body
      });
      const text = await response.text();
      let json: unknown | null = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return {
        ok: response.ok,
        status: response.status,
        headers: [...response.headers.entries()] as [string, string][],
        text,
        json
      };
    };
  }

  return host;
}

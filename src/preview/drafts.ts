import { parseModuleManifest, type ModuleManifest } from '../widgets/module-manifest';

// A draft module discovered under the repo-root `dev-modules/` directory. This
// is where an AI tool (Codex, Cursor, …) or a human writes work-in-progress
// module files; the preview page renders whichever one is selected. See
// docs/custom-modules/install/AGENTS.md for the authoring convention.

export type Draft = {
  // File path relative to the repo root, e.g. "/dev-modules/my-module.js".
  path: string;
  // Just the file name, e.g. "my-module.js".
  name: string;
  source: string;
  // Parsed manifest, or null when the header is missing/invalid.
  manifest: ModuleManifest | null;
  // Manifest parse error key, when parsing failed.
  error: string | null;
};

// Vite eagerly inlines every dev-modules/*.js file as a raw string at build
// time, and re-evaluates this glob (triggering a full reload) whenever a file
// is added, removed, or edited — which is exactly the hot-remount the preview
// wants. `import.meta.glob` is a Vite compile-time macro, not a runtime call.
const modules = import.meta.glob('/dev-modules/*.js', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

export function loadDrafts(): Draft[] {
  const drafts: Draft[] = [];
  for (const [path, source] of Object.entries(modules)) {
    const name = path.split('/').pop() ?? path;
    let manifest: ModuleManifest | null = null;
    let error: string | null = null;
    try {
      manifest = parseModuleManifest(source);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
    drafts.push({ path, name, source, manifest, error });
  }
  drafts.sort((a, b) => a.name.localeCompare(b.name));
  return drafts;
}

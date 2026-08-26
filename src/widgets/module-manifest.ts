import type { SandboxExtensionDraft, SandboxPermission } from '../data/nowly-repository';

// A parsed module manifest header. Authors declare metadata in a leading block
// comment so a single `.js` file is self-describing: the installer reads this to
// build the install draft, and the module market reads the same fields from its
// registry index.
//
// Example header:
//   /**
//    * @nowly-module 1
//    * @id           weather-widget
//    * @name         天气
//    * @version      1.0.0
//    * @author       yourname
//    * @description  显示当前城市天气
//    * @permissions  state, today, network
//    * @network      api.open-meteo.com, api.weather.com
//    * @minSize      3x3
//    * @defaultSize  4x4
//    */
export type ModuleManifest = {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  permissions: SandboxPermission[];
  network: string[];
  // Whether the module's content area runs continuous motion. `static` (the
  // default) means instant state changes only; `animated` opts into the
  // conditionally-allowed motion described in design.md §10, and obligates the
  // module to pause when not visible (enforced by the validator).
  motion: 'static' | 'animated';
  minW: number;
  minH: number;
  defaultW: number;
  defaultH: number;
};

export class ManifestError extends Error {}

const KNOWN_PERMISSIONS: SandboxPermission[] = ['state', 'today', 'network'];

// Pull the leading block comment (the manifest). Only the first `/** ... */` at
// the top of the file (optionally preceded by whitespace) is considered, so a
// module cannot smuggle a second manifest lower down.
function extractHeader(source: string): string | null {
  const match = source.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  return match ? match[1] : null;
}

// Read every `@tag value` line from the header into a map. Later duplicates win.
function readTags(header: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const rawLine of header.split('\n')) {
    // Strip a leading ` * ` decoration if present.
    const line = rawLine.replace(/^\s*\*?\s?/, '').trimEnd();
    const match = line.match(/^@([a-zA-Z-]+)\s*(.*)$/);
    if (match) tags.set(match[1].toLowerCase(), match[2].trim());
  }
  return tags;
}

// Parse a `WxH` size, returning [w, h] or null when malformed.
function parseSize(value: string | undefined): [number, number] | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// Parse and validate a module manifest from raw source. Throws ManifestError
// with a human-readable (localizable-at-call-site) message on any problem.
export function parseModuleManifest(source: string): ModuleManifest {
  const header = extractHeader(source);
  if (header === null) throw new ManifestError('missing-header');
  const tags = readTags(header);

  if (tags.get('nowly-module') !== '1') throw new ManifestError('bad-version-tag');

  const id = tags.get('id') ?? '';
  if (!ID_PATTERN.test(id)) throw new ManifestError('bad-id');

  const name = tags.get('name') ?? '';
  if (!name) throw new ManifestError('missing-name');

  const version = tags.get('version') ?? '';
  if (!version) throw new ManifestError('missing-version');

  const permissions: SandboxPermission[] = [];
  for (const entry of splitList(tags.get('permissions'))) {
    if (!KNOWN_PERMISSIONS.includes(entry as SandboxPermission)) {
      throw new ManifestError('unknown-permission');
    }
    if (!permissions.includes(entry as SandboxPermission)) {
      permissions.push(entry as SandboxPermission);
    }
  }

  const network = splitList(tags.get('network')).map((host) => host.toLowerCase());
  if (permissions.includes('network') && network.length === 0) {
    throw new ManifestError('network-without-hosts');
  }
  if (!permissions.includes('network') && network.length > 0) {
    throw new ManifestError('hosts-without-network');
  }

  const motionRaw = (tags.get('motion') ?? 'static').toLowerCase();
  if (motionRaw !== 'static' && motionRaw !== 'animated') {
    throw new ManifestError('bad-motion');
  }
  const motion = motionRaw as 'static' | 'animated';

  const min = parseSize(tags.get('minsize')) ?? [2, 2];
  const def = parseSize(tags.get('defaultsize')) ?? [4, 4];

  return {
    id,
    name,
    version,
    author: tags.get('author') ?? '',
    description: tags.get('description') ?? '',
    permissions,
    network,
    motion,
    minW: min[0],
    minH: min[1],
    defaultW: def[0],
    defaultH: def[1]
  };
}

// Turn a parsed manifest + source into the install draft the backend expects.
export function manifestToDraft(manifest: ModuleManifest, source: string): SandboxExtensionDraft {
  return {
    name: manifest.name,
    description: manifest.description,
    source,
    permissions: manifest.permissions,
    allowedHosts: manifest.network,
    defaultW: manifest.defaultW,
    defaultH: manifest.defaultH
  };
}

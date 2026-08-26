import type { ModuleHost } from '../extension-module';
import { t } from '../../i18n';

// The wire protocol between the app (parent) and a sandboxed extension running
// inside an isolated iframe. The channel marker lets both sides ignore any
// unrelated postMessage traffic; the parent additionally verifies the message
// source is the specific iframe, so this is not a trust boundary on its own.
export const SANDBOX_CHANNEL = 'nowly-module-v1';

// The capabilities an extension may hold. Declared at install time, granted at
// init, and enforced per request — an extension can never reach a method it did
// not declare.
export type SandboxPermission = 'state' | 'today' | 'network';

// The RPC methods a guest may invoke on the host.
export type SandboxMethod = 'loadState' | 'saveState' | 'fetch';

// Which host methods each permission unlocks. `today` is not a method gate; it
// controls whether `todayIso` is handed over at init (see below).
const METHOD_PERMISSION: Record<SandboxMethod, SandboxPermission> = {
  loadState: 'state',
  saveState: 'state',
  fetch: 'network'
};

// Which surface a guest frame is rendering. A module runs in the `main` card by
// default; when it asks to open a settings/detail panel that cannot fit inside
// the card (2x2 is ~195x143px), the host mounts a *second* iframe loading the
// same source and marks it `dialog` via init. The module branches on this to
// draw its main content or its dialog content. See spec §11 Q3 / §12 step 6.
export type SandboxSurface = 'main' | 'dialog';

// Parent -> guest: sent once the guest reports ready. Carries the only ambient
// context a module gets, filtered by its granted permissions. `todayIso` is
// present only when the `today` permission was granted.
export type SandboxInit = {
  channel: typeof SANDBOX_CHANNEL;
  kind: 'init';
  moduleId: string;
  permissions: SandboxPermission[];
  // Which surface this frame is: the main card or the host-rendered dialog.
  // Absent is treated as 'main' so older callers keep their behavior.
  surface?: SandboxSurface;
  todayIso?: string;
  // Hosts the guest may reach via `host.fetch`. Present only when the `network`
  // permission was granted; the runtime exposes `fetch` based on `permissions`.
  allowedHosts?: string[];
  // Localized prefix shown before a runtime error message. Passed in from the
  // host because the sandboxed runtime cannot reach the i18n tables itself.
  errorPrefix?: string;
  // The module's initial visibility. Modules that animate must pause when this
  // is false and resume when a later `visibility` message flips it true. Absent
  // is treated as visible.
  visible?: boolean;
};

// Parent -> guest: the module's on-screen visibility changed. Nowly is a
// resident desktop app; a module's requestAnimationFrame loop runs on the same
// render thread as the app, so an off-screen animation keeps waking the GPU for
// nothing. The host observes the iframe (intersection + document visibility +
// focus mode) and pushes the combined state here; animated modules must honor
// it. See docs/superpowers/specs/2026-08-25-nowly-module-system-v2-design.md §7.
export type SandboxVisibility = {
  channel: typeof SANDBOX_CHANNEL;
  kind: 'visibility';
  visible: boolean;
};

// Guest -> parent: ask the host to open the dialog surface. The host mounts a
// second iframe loading the same module source, marked `surface: 'dialog'` at
// init. `title` (optional) is shown in the dialog chrome header. A module that
// is already the dialog surface may still send this; the host ignores redundant
// opens.
export type SandboxOpenDialog = {
  channel: typeof SANDBOX_CHANNEL;
  kind: 'openDialog';
  title?: string;
};

// Guest -> parent: ask the host to close the dialog surface. Typically sent by
// the dialog surface itself ("Done"/"Cancel"), but the main surface may also
// request it. The host tears the dialog iframe down and revokes its Blob URL.
export type SandboxCloseDialog = {
  channel: typeof SANDBOX_CHANNEL;
  kind: 'closeDialog';
};

// Parent -> guest: this module's persisted state changed on another surface.
// Both surfaces share one `moduleId` and therefore one state row, so after the
// dialog saves its settings the host broadcasts this to the main surface (and
// vice versa) so the receiver can re-run `loadState` and refresh — otherwise a
// change made in the dialog would leave the card showing stale values. See spec
// §11 Q3.
export type SandboxStateChanged = {
  channel: typeof SANDBOX_CHANNEL;
  kind: 'stateChanged';
};

// Guest -> parent: an RPC call for one of the allowed host methods. This is the
// entire capability surface a sandboxed extension has — nothing else is reachable.
export type SandboxRequest = {
  channel: typeof SANDBOX_CHANNEL;
  kind: 'request';
  id: number;
  method: SandboxMethod;
  args: unknown[];
};

// Parent -> guest: the result of one request, matched back by `id`.
export type SandboxResponse = {
  channel: typeof SANDBOX_CHANNEL;
  kind: 'response';
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
};

// Guest -> parent: emitted once the guest runtime has loaded and registered its
// module, so the parent knows it is safe to send `init`.
export type SandboxReady = {
  channel: typeof SANDBOX_CHANNEL;
  kind: 'ready';
};

// Narrow untrusted postMessage data to a request we recognize. Anything failing
// this guard is ignored rather than trusted.
export function isSandboxRequest(data: unknown): data is SandboxRequest {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Record<string, unknown>;
  return (
    message.channel === SANDBOX_CHANNEL &&
    message.kind === 'request' &&
    typeof message.id === 'number' &&
    (message.method === 'loadState' ||
      message.method === 'saveState' ||
      message.method === 'fetch') &&
    Array.isArray(message.args)
  );
}

export function isSandboxReady(data: unknown): data is SandboxReady {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Record<string, unknown>;
  return message.channel === SANDBOX_CHANNEL && message.kind === 'ready';
}

export function isSandboxVisibility(data: unknown): data is SandboxVisibility {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Record<string, unknown>;
  return (
    message.channel === SANDBOX_CHANNEL &&
    message.kind === 'visibility' &&
    typeof message.visible === 'boolean'
  );
}

export function isSandboxOpenDialog(data: unknown): data is SandboxOpenDialog {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Record<string, unknown>;
  return (
    message.channel === SANDBOX_CHANNEL &&
    message.kind === 'openDialog' &&
    (message.title === undefined || typeof message.title === 'string')
  );
}

export function isSandboxCloseDialog(data: unknown): data is SandboxCloseDialog {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Record<string, unknown>;
  return message.channel === SANDBOX_CHANNEL && message.kind === 'closeDialog';
}

// A simple sliding-window rate limiter. A misbehaving extension that floods the
// channel gets its excess requests rejected rather than tying up the host.
export function createRateLimiter(limit: number, windowMs: number): () => boolean {
  const hits: number[] = [];
  return () => {
    const now = Date.now();
    while (hits.length > 0 && now - hits[0] >= windowMs) hits.shift();
    if (hits.length >= limit) return false;
    hits.push(now);
    return true;
  };
}

// How the host decides whether a request may run: the granted permission set, a
// throttle predicate, and the network allow-list. Defaults are permissive on
// permissions (state/today granted) but always throttled, so existing call sites
// keep working.
export type SandboxGrant = {
  permissions: SandboxPermission[];
  allow: () => boolean;
  // Hosts the guest may reach via `host.fetch`. Empty means no network egress
  // even if the `network` permission was somehow granted.
  allowedHosts?: string[];
};

const defaultGrant: SandboxGrant = {
  permissions: ['state', 'today'],
  allow: () => true,
  allowedHosts: []
};

// Extract the lowercased host from a URL string, or null when it cannot be
// parsed. Used to check a fetch target against the allow-list before proxying.
function hostOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// The heart of the host side: turn one validated request into a response by
// dispatching to the (already narrowed) host API, after checking the grant.
// Pure aside from the host it is given, so it is unit-testable without a DOM or
// a real iframe.
export async function handleSandboxRequest(
  host: ModuleHost,
  request: SandboxRequest,
  grant: SandboxGrant = defaultGrant
): Promise<SandboxResponse> {
  const reject = (error: string): SandboxResponse => ({
    channel: SANDBOX_CHANNEL,
    kind: 'response',
    id: request.id,
    ok: false,
    error
  });

  // Permission gate: the method's required permission must have been granted.
  const required = METHOD_PERMISSION[request.method];
  if (!grant.permissions.includes(required)) {
    return reject(t('sandbox.noPermission', { permission: required }));
  }
  // Throttle gate: reject once the window is saturated.
  if (!grant.allow()) {
    return reject(t('sandbox.throttled'));
  }

  try {
    if (request.method === 'loadState') {
      const result = await host.loadState();
      return { channel: SANDBOX_CHANNEL, kind: 'response', id: request.id, ok: true, result };
    }
    if (request.method === 'fetch') {
      if (!host.fetch) {
        return reject(t('sandbox.noPermission', { permission: 'network' }));
      }
      // Allow-list gate: the target host must be one the module declared. This
      // is a fast local reject; the Rust proxy re-checks as the real boundary.
      const targetHost = hostOf(request.args[0]);
      const allowed = grant.allowedHosts ?? [];
      if (!targetHost || !allowed.some((entry) => entry.toLowerCase() === targetHost)) {
        return reject(t('sandbox.hostNotAllowed'));
      }
      const options = (request.args[1] ?? {}) as {
        method?: 'GET' | 'POST';
        headers?: [string, string][];
        body?: string;
      };
      const result = await host.fetch(request.args[0] as string, options);
      return { channel: SANDBOX_CHANNEL, kind: 'response', id: request.id, ok: true, result };
    }
    // saveState
    await host.saveState(request.args[0]);
    return { channel: SANDBOX_CHANNEL, kind: 'response', id: request.id, ok: true };
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error));
  }
}

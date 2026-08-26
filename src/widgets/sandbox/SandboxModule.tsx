import { useEffect, useMemo, useRef } from 'react';
import type { ModuleHost } from '../extension-module';
import type { SandboxPermission } from '../../data/nowly-repository';
import {
  SANDBOX_CHANNEL,
  SANDBOX_CHANNEL as CHANNEL,
  createRateLimiter,
  handleSandboxRequest,
  isSandboxReady,
  isSandboxRequest,
  type SandboxGrant,
  type SandboxInit,
  type SandboxVisibility
} from './sandbox-protocol';
import { createSandboxUrl } from './sandbox-runtime';
import { observeVisibility } from './sandbox-visibility';
import { t } from '../../i18n';

// Runs a third-party extension inside an isolated iframe. The extension code
// never touches this window: it can only post messages back, and the only
// capabilities it gets are the host methods dispatched in `handleSandboxRequest`
// (load/save its own state), gated by its declared permissions and throttled.
// The iframe is sandboxed with `allow-scripts` only — no `allow-same-origin`, so
// it has a null origin and cannot reach cookies, storage, the parent DOM, or
// Tauri, and its CSP blocks all network egress.
export function SandboxModule({
  host,
  source,
  title,
  permissions,
  allowedHosts = []
}: {
  host: ModuleHost;
  source: string;
  title: string;
  permissions: SandboxPermission[];
  // Hosts the module may reach through `host.fetch`. Forwarded into the grant
  // so the parent enforces the allow-list before proxying, and again in Rust.
  allowedHosts?: string[];
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Latest visibility reading and whether the guest is ready to receive it. The
  // observer may fire before the frame signals ready, so we cache the flag and
  // fold the current value into `init`, then post updates only once ready.
  const visibleRef = useRef(true);
  const readyRef = useRef(false);
  // A fresh Blob URL per source. Revoked on unmount / source change so we don't
  // leak object URLs.
  const url = useMemo(() => createSandboxUrl(source), [source]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    readyRef.current = false;

    // One rate limiter per mounted frame: at most 30 host calls per second.
    const allow = createRateLimiter(30, 1000);
    const grant: SandboxGrant = { permissions, allow, allowedHosts };

    // Track on-screen + foreground state; relay to the guest once it is ready
    // so animated modules can pause off-screen.
    const stopObserving = observeVisibility(iframe, (visible) => {
      visibleRef.current = visible;
      if (!readyRef.current) return;
      const message: SandboxVisibility = { channel: CHANNEL, kind: 'visibility', visible };
      iframe?.contentWindow?.postMessage(message, '*');
    });

    async function onMessage(event: MessageEvent) {
      // Only trust messages from *this* iframe. Because the frame is sandboxed
      // with a null origin, origin checks are meaningless; source identity is
      // the real gate.
      if (event.source !== iframe?.contentWindow) return;
      const data = event.data;

      if (isSandboxReady(data)) {
        const init: SandboxInit = {
          channel: SANDBOX_CHANNEL,
          kind: 'init',
          moduleId: host.moduleId,
          permissions,
          errorPrefix: t('sandbox.runError'),
          // Only hand over today's date when the extension declared `today`.
          ...(permissions.includes('today') ? { todayIso: host.todayIso } : {}),
          // Hand the allow-list to the guest runtime so it can expose `fetch`
          // only when network was granted.
          ...(permissions.includes('network') ? { allowedHosts } : {}),
          // Fold in the current visibility so the module starts in the right
          // running/paused state.
          visible: visibleRef.current
        };
        readyRef.current = true;
        iframe?.contentWindow?.postMessage(init, '*');
        return;
      }

      if (isSandboxRequest(data)) {
        const response = await handleSandboxRequest(host, data, grant);
        iframe?.contentWindow?.postMessage(response, '*');
      }
    }

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      stopObserving();
    };
  }, [host, permissions, allowedHosts, url]);

  return (
    <div className="widget-content sandbox-module">
      <div className="card-header">
        <div className="heading-group">
          <h2>{title}</h2>
        </div>
      </div>
      <div className="panel-body sandbox-module__body">
        <iframe
          ref={iframeRef}
          className="sandbox-module__frame"
          title={title}
          // allow-scripts WITHOUT allow-same-origin keeps the frame at a null
          // origin: scripts run, but the guest cannot reach our origin's DOM,
          // storage, or APIs. Everything crosses the postMessage channel.
          sandbox="allow-scripts"
          src={url}
        />
      </div>
    </div>
  );
}

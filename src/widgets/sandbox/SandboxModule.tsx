import { useEffect, useMemo, useRef } from 'react';
import type { ModuleHost } from '../extension-module';
import type { SandboxPermission } from '../../data/nowly-repository';
import {
  SANDBOX_CHANNEL,
  createRateLimiter,
  handleSandboxRequest,
  isSandboxReady,
  isSandboxRequest,
  type SandboxGrant,
  type SandboxInit
} from './sandbox-protocol';
import { createSandboxUrl } from './sandbox-runtime';
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
  permissions
}: {
  host: ModuleHost;
  source: string;
  title: string;
  permissions: SandboxPermission[];
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // A fresh Blob URL per source. Revoked on unmount / source change so we don't
  // leak object URLs.
  const url = useMemo(() => createSandboxUrl(source), [source]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    // One rate limiter per mounted frame: at most 30 host calls per second.
    const allow = createRateLimiter(30, 1000);
    const grant: SandboxGrant = { permissions, allow };

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
          ...(permissions.includes('today') ? { todayIso: host.todayIso } : {})
        };
        iframe?.contentWindow?.postMessage(init, '*');
        return;
      }

      if (isSandboxRequest(data)) {
        const response = await handleSandboxRequest(host, data, grant);
        iframe?.contentWindow?.postMessage(response, '*');
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [host, permissions]);

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

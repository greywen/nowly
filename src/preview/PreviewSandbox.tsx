import { useEffect, useMemo, useRef } from 'react';
import type { ModuleHost } from '../widgets/extension-module';
import type { SandboxPermission } from '../widgets/sandbox/sandbox-protocol';
import {
  SANDBOX_CHANNEL,
  createRateLimiter,
  handleSandboxRequest,
  isSandboxReady,
  isSandboxRequest,
  type SandboxGrant,
  type SandboxInit,
  type SandboxVisibility
} from '../widgets/sandbox/sandbox-protocol';
import { createSandboxUrl } from '../widgets/sandbox/sandbox-runtime';
import { observeVisibility } from '../widgets/sandbox/sandbox-visibility';
import { t } from '../i18n';

// Renders a draft module inside the very same isolated iframe the desktop app
// uses (null-origin, allow-scripts only, network-blocking CSP, injected nm-*
// stylesheet). The only difference from the app's SandboxModule is the host:
// here it is the in-memory preview host, and there is no card chrome — the
// frame is sized to the selected gear so the author sees a faithful preview.
export function PreviewSandbox({
  host,
  source,
  permissions,
  allowedHosts = [],
  width,
  height
}: {
  host: ModuleHost;
  source: string;
  permissions: SandboxPermission[];
  allowedHosts?: string[];
  width: number;
  height: number;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const visibleRef = useRef(true);
  const readyRef = useRef(false);
  // A fresh Blob URL per source so editing a draft remounts cleanly. Revoked on
  // unmount / source change to avoid leaking object URLs.
  const url = useMemo(() => createSandboxUrl(source), [source]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    readyRef.current = false;

    const allow = createRateLimiter(30, 1000);
    const grant: SandboxGrant = { permissions, allow, allowedHosts };

    const stopObserving = observeVisibility(iframe, (visible) => {
      visibleRef.current = visible;
      if (!readyRef.current) return;
      const message: SandboxVisibility = { channel: SANDBOX_CHANNEL, kind: 'visibility', visible };
      iframe?.contentWindow?.postMessage(message, '*');
    });

    async function onMessage(event: MessageEvent) {
      if (event.source !== iframe?.contentWindow) return;
      const data = event.data;

      if (isSandboxReady(data)) {
        const init: SandboxInit = {
          channel: SANDBOX_CHANNEL,
          kind: 'init',
          moduleId: host.moduleId,
          permissions,
          errorPrefix: t('sandbox.runError'),
          ...(permissions.includes('today') ? { todayIso: host.todayIso } : {}),
          ...(permissions.includes('network') ? { allowedHosts } : {}),
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
    <div className="preview-stage">
      <div className="preview-stage__frame-wrap" style={{ width, height }}>
        <iframe
          ref={iframeRef}
          className="preview-sandbox__frame"
          title="module preview"
          sandbox="allow-scripts"
          src={url}
          style={{ width, height }}
        />
      </div>
      <p className="preview-stage__dims">
        {width} × {height} px
      </p>
    </div>
  );
}

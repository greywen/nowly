import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ModuleHost } from '../extension-module';
import type { SandboxPermission } from '../../data/nowly-repository';
import {
  SANDBOX_CHANNEL,
  SANDBOX_CHANNEL as CHANNEL,
  createRateLimiter,
  handleSandboxRequest,
  isSandboxCloseDialog,
  isSandboxOpenDialog,
  isSandboxReady,
  isSandboxRequest,
  type SandboxGrant,
  type SandboxInit,
  type SandboxStateChanged,
  type SandboxSurface,
  type SandboxVisibility
} from './sandbox-protocol';
import { createSandboxUrl } from './sandbox-runtime';
import { observeVisibility } from './sandbox-visibility';
import { Dialog } from '../../components/Dialog';
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
  // The optional dialog surface (spec §11 Q3): a second iframe loading the same
  // source, marked `surface: 'dialog'` at init, mounted inside a host-rendered
  // Dialog so a settings panel can break out of the 2x2 card (≈195×143px). Its
  // title comes from the guest's openDialog request.
  const dialogFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [dialog, setDialog] = useState<{ title: string } | null>(null);
  // Restore focus to the main frame's card when the dialog closes.
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Latest visibility reading and whether the guest is ready to receive it. The
  // observer may fire before the frame signals ready, so we cache the flag and
  // fold the current value into `init`, then post updates only once ready.
  const visibleRef = useRef(true);
  const readyRef = useRef(false);
  // A fresh Blob URL per source. Revoked on unmount / source change so we don't
  // leak object URLs.
  const url = useMemo(() => createSandboxUrl(source), [source]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  // The dialog frame needs its OWN Blob URL: Chromium refuses to load the same
  // blob: document in a second null-origin sandboxed iframe (the second frame
  // ends up at chrome-error://). Minting a distinct URL for the same source
  // side-steps that while still running an identical guest. Created when the
  // dialog opens, revoked when it closes.
  const dialogUrl = useMemo(() => (dialog ? createSandboxUrl(source) : null), [dialog, source]);
  useEffect(() => {
    if (!dialogUrl) return;
    return () => URL.revokeObjectURL(dialogUrl);
  }, [dialogUrl]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    readyRef.current = false;

    // One rate limiter shared by both surfaces of this module: at most 30 host
    // calls per second across the pair.
    const allow = createRateLimiter(30, 1000);
    const grant: SandboxGrant = { permissions, allow, allowedHosts };

    // Build the init payload for whichever surface just reported ready.
    const buildInit = (surface: SandboxSurface, visible: boolean): SandboxInit => ({
      channel: SANDBOX_CHANNEL,
      kind: 'init',
      moduleId: host.moduleId,
      permissions,
      surface,
      errorPrefix: t('sandbox.runError'),
      // Only hand over today's date when the extension declared `today`.
      ...(permissions.includes('today') ? { todayIso: host.todayIso } : {}),
      // Hand the allow-list to the guest runtime so it can expose `fetch`
      // only when network was granted.
      ...(permissions.includes('network') ? { allowedHosts } : {}),
      // Fold in the current visibility so the module starts in the right
      // running/paused state.
      visible
    });

    // Track on-screen + foreground state; relay to the guest once it is ready
    // so animated modules can pause off-screen.
    const stopObserving = observeVisibility(iframe, (visible) => {
      visibleRef.current = visible;
      if (!readyRef.current) return;
      const message: SandboxVisibility = { channel: CHANNEL, kind: 'visibility', visible };
      iframe?.contentWindow?.postMessage(message, '*');
    });

    async function onMessage(event: MessageEvent) {
      // Only trust messages from *this module's* frames. Because the frames are
      // sandboxed with a null origin, origin checks are meaningless; source
      // identity is the real gate.
      const mainWindow = iframe?.contentWindow ?? null;
      const dialogWindow = dialogFrameRef.current?.contentWindow ?? null;
      const fromMain = event.source === mainWindow;
      const fromDialog = dialogWindow !== null && event.source === dialogWindow;
      if (!fromMain && !fromDialog) return;
      const senderWindow = fromDialog ? dialogWindow : mainWindow;
      const data = event.data;

      if (isSandboxReady(data)) {
        // The dialog surface is always on-screen while mounted; the main
        // surface uses its observed visibility.
        if (fromMain) readyRef.current = true;
        const init = buildInit(fromDialog ? 'dialog' : 'main', fromDialog ? true : visibleRef.current);
        senderWindow?.postMessage(init, '*');
        return;
      }

      if (isSandboxOpenDialog(data)) {
        setDialog({ title: data.title ?? title });
        return;
      }

      if (isSandboxCloseDialog(data)) {
        setDialog(null);
        return;
      }

      if (isSandboxRequest(data)) {
        const response = await handleSandboxRequest(host, data, grant);
        senderWindow?.postMessage(response, '*');
        // A successful saveState changes the one state row both surfaces share.
        // Tell the *other* surface to reload so it never shows stale values.
        if (response.ok && data.method === 'saveState') {
          const changed: SandboxStateChanged = { channel: CHANNEL, kind: 'stateChanged' };
          const other = fromDialog ? mainWindow : dialogWindow;
          other?.postMessage(changed, '*');
        }
      }
    }

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      stopObserving();
    };
  }, [host, permissions, allowedHosts, url, title]);

  return (
    <div ref={cardRef} className="widget-content sandbox-module">
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
      {dialog ? (
        <Dialog
          title={dialog.title}
          ariaLabelledBy=""
          restoreFocusRef={cardRef}
          onRequestClose={() => setDialog(null)}
          className="sandbox-module-dialog"
          headerActions={
            <button
              type="button"
              className="good-icon-button"
              aria-label={t('common.close')}
              onClick={() => setDialog(null)}
            >
              <X aria-hidden="true" />
            </button>
          }
        >
          <iframe
            ref={dialogFrameRef}
            className="sandbox-module__frame sandbox-module__frame--dialog"
            title={dialog.title}
            // Same null-origin isolation as the main frame; same source, so the
            // guest runtime is identical and only the init `surface` differs.
            // A distinct Blob URL is required (see dialogUrl above).
            sandbox="allow-scripts"
            src={dialogUrl ?? undefined}
          />
        </Dialog>
      ) : null}
    </div>
  );
}

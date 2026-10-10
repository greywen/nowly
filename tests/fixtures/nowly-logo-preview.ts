/** Dev-only interactive harness. Uses the real app, with no native/data writes. */
export function installLogoPreview() {
  let callbackId = 0;
  let generation = 0;
  let openSource: 'island' | 'nowly' | null = null;
  const listeners = new Map<string, number>();
  function emit(event: string, payload: unknown) {
    const id = listeners.get(event);
    const callback = id ? Reflect.get(window, `_${id}`) : null;
    if (typeof callback === 'function') callback({ event, payload });
  }
  function closePanel() {
    const wait = 260;
    openSource = null;
    const closing = ++generation;
    emit('status-island-details-close', { generation: closing, hideAfterCollapse: false, collapseToSummary: true });
    window.setTimeout(() => {
      if (closing === generation) emit('status-island-details-closed', { generation: closing });
    }, wait);
  }
  Object.assign(window, {
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
    __TAURI_INTERNALS__: {
      metadata: {
        currentWindow: { label: 'quick-panel-handle' },
        currentWebview: { label: 'quick-panel-handle' }
      },
      transformCallback(callback: unknown) {
        const id = ++callbackId;
        Reflect.set(window, `_${id}`, callback);
        return id;
      },
      async invoke(command: string, args?: { event?: string; handler?: number }) {
        if (command === 'plugin:event|listen' && args?.event && args.handler) {
          listeners.set(args.event, args.handler);
          return args.handler;
        }
        if (command === 'get_status_island_snapshot') return {
          sampledAt: new Date().toISOString(), localDate: '2026-09-17',
          events: [], externalEvents: [], tasks: [], reminders: [],
          focus: { status: 'idle', remainingSeconds: 0, plannedSeconds: 0, sessionId: null, stageSequence: 0, stageChangedAt: null }
        };
        if (command === 'assistant_get_config') return {
          endpoint: 'https://example.invalid/v1', model: 'local-animation-preview', hasKey: true,
          permissions: { calendar: false, tasks: false, external: false }
        };
        if (command === 'assistant_interpret') return {
          kind: 'clarify', message: '这是形变预览，没有执行操作。按 Esc 或点击右上角收起，观察面板回到 Logo。', records: [], plan: null
        };
        if (command === 'toggle_nowly_panel' || command === 'toggle_status_island_details') {
          const next = command === 'toggle_nowly_panel' ? 'nowly' : 'island';
          if (openSource === next) closePanel();
          else {
            openSource = next;
            emit('status-island-details-open', { generation: ++generation, source: next, identity: null, hovered: false });
          }
        }
        if (command === 'close_status_island_details') {
          closePanel();
        }
        return null;
      }
    }
  });
}

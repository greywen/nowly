import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StatusIslandIdleView,
  StatusIslandPanel,
  StatusIslandReminderView,
  StatusIslandSummaryView,
  TopRail
} from '../app/layout/StatusIsland';
import { reminderPanelContext } from '../app/status-island-model';
import { useStatusIslandSnapshot } from './useStatusIslandSnapshot';
import { useStatusIslandDrag } from './useStatusIslandDrag';
import { useTransparentSurfaces } from './useTransparentSurfaces';
import { useTranslation } from '../i18n';
import { t } from '../i18n';
import type { BarAppId } from '../app/bar-buttons';
import { AssistantDock } from '../assistant/AssistantDock';

// Startup stays pending until the native capture surfaces are ready.
const BAR_BUTTON_COMMANDS: Record<BarAppId, string> = {
  screenshot: 'start_screen_capture'
};

function barButtonErrorMessage(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null && 'message' in reason) {
    const { message } = reason as { message?: unknown };
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (typeof reason === 'string' && reason.trim()) return reason;
  return t('barButtons.unavailable');
}

type PanelSource = 'island' | 'nowly';
type RailSurface = 'status' | 'assistant';

// One native window hosts two independent sibling panels. The native source
// selects which panel is open; each panel owns its own animation state.
//
// Native owns whether the sheet is open, because it also owns the window size,
// the 300ms hover delay and the acknowledgement that goes with opening. This
// component follows the open/close events rather than holding its own opinion.

function reportPresence(surface: 'island' | 'keyboard' | 'details' | 'action', present: boolean): void {
  void invoke('set_status_island_presence', { surface, present });
}

/** Holds the surface open for the duration of an action, then releases it. */
async function withActionHold(run: () => Promise<unknown>): Promise<void> {
  reportPresence('action', true);
  try {
    await run();
  } finally {
    reportPresence('action', false);
  }
}

export function StatusIslandApp() {
  useTransparentSurfaces();
  const { t } = useTranslation();
  const { model, status, refresh, notificationMode, barButtons } = useStatusIslandSnapshot();
  const drag = useStatusIslandDrag();
  const surfaceState = model.surface;
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<PanelSource>('island');
  const nativeSource = useRef<PanelSource>('island');
  const [assistantSurface, setAssistantSurface] = useState<'assistant' | null>(null);
  const assistantSurfaceRef = useRef<'assistant' | null>(null);
  assistantSurfaceRef.current = assistantSurface;
  const [assistantClosing, setAssistantClosing] = useState(false);
  const closingGeneration = useRef<number | null>(null);
  const transitionGeneration = useRef(0);
  const assistantSheetRequested = useRef(false);
  // Null until the first transition, so the rail does not animate itself into
  // existence on mount.
  const [statusAnim, setStatusAnim] = useState<'grow' | 'shrink' | null>(null);
  const [assistantAnim, setAssistantAnim] = useState<'grow' | 'shrink' | null>(null);
  const [collapsedNotificationKey, setCollapsedNotificationKey] = useState<string | null>(null);
  // The sheet is opened *for* one reminder and stays pinned to it by identity.
  // It must not follow the live queue head: once the shown reminder is hidden the
  // head becomes the next reminder, and an unpinned sheet would silently swap its
  // content — and what its action buttons act on — under the user.
  const [pinnedIdentity, setPinnedIdentity] = useState<string | null>(null);
  const pinnedReminder = useMemo(
    () => pinnedIdentity === null
      ? null
      : model.reminders.find(reminder => reminder.identity === pinnedIdentity) ?? null,
    [model.reminders, pinnedIdentity]
  );
  const unseenNotificationKey = model.reminders
    .filter(reminder => reminder.lifecycle === 'unseen')
    .map(reminder => reminder.identity)
    .sort()
    .join('\0');
  const unseenNotificationKeyRef = useRef(unseenNotificationKey);
  unseenNotificationKeyRef.current = unseenNotificationKey;
  const collapsedToSummary = collapsedNotificationKey !== null
    && collapsedNotificationKey === unseenNotificationKey;
  const notificationModeRef = useRef(notificationMode);
  notificationModeRef.current = notificationMode;
  // The sheet is one continuous object, so its head and body must describe the
  // same subject. Keep the opened reminder in the head until the sheet closes,
  // even after acknowledgement advances the live queue underneath it.
  const displayedSurface = open && pinnedReminder
    ? { mode: 'detail' as const, reminder: pinnedReminder }
    : collapsedToSummary && surfaceState.mode !== 'idle'
      ? { mode: 'summary' as const, summary: model.summary }
    : surfaceState;
  const reopenSummaryRef = useRef(false);
  reopenSummaryRef.current = notificationMode === 'persistent'
    && displayedSurface.mode === 'summary';
  // Native records acknowledgement against whatever the capsule is showing. In
  // summary and idle mode it is showing no single reminder, so there is nothing
  // to acknowledge.
  const primaryIdentity = surfaceState.mode === 'detail' ? surfaceState.reminder.identity : null;
  const lastPresence = useRef(false);
  const [nativeHidePending, setNativeHidePending] = useState(false);
  const lastStatusActivationSource = useRef<'pointer' | 'keyboard' | null>(null);
  const visibilityRequest = useRef<Promise<void>>(Promise.resolve());
  const requestVisibility = useCallback((visible: boolean) => {
    visibilityRequest.current = visibilityRequest.current
      .catch(() => undefined)
      .then(() => invoke('set_status_island_visibility', { visible }))
      .then(() => undefined);
  }, []);
  const collapse = useCallback(() => void invoke('close_status_island_details'), []);

  useEffect(() => {
    void invoke('set_status_island_primary', { identity: primaryIdentity });
  }, [primaryIdentity]);

  useEffect(() => {
    if (status !== 'ready') return;
    if (notificationMode === 'notification' && unseenNotificationKey) {
      requestVisibility(true);
    }
  }, [notificationMode, requestVisibility, status, unseenNotificationKey]);

  useEffect(() => {
    if (
      status === 'ready'
      && notificationMode === 'notification'
      && unseenNotificationKey === ''
      && !open
      && !nativeHidePending
    ) {
      requestVisibility(false);
    }
  }, [nativeHidePending, notificationMode, open, requestVisibility, status, unseenNotificationKey]);

  useEffect(() => {
    if (!nativeHidePending) return;
    // Native collapse waits 260ms; allow one more late frame before fallback.
    const timer = setTimeout(() => setNativeHidePending(false), 300);
    return () => clearTimeout(timer);
  }, [nativeHidePending]);

  useEffect(() => {
    const removers: Array<() => void> = [];
    let disposed = false;
    const keep = (remove: () => void) => disposed ? remove() : removers.push(remove);
    void listen<{ generation?: number; source: PanelSource; identity: string | null; hovered?: boolean } | null>('status-island-details-open', event => {
      const generation = event.payload?.generation;
      if (generation !== undefined) {
        if (generation < transitionGeneration.current) return;
        transitionGeneration.current = generation;
      }
      setNativeHidePending(false);
      setAssistantClosing(false);
      closingGeneration.current = null;
      const nextSource = event.payload?.source ?? 'island';
      nativeSource.current = nextSource;
      setSource(nextSource);
      assistantSheetRequested.current = false;
      setAssistantSurface(nextSource === 'nowly' ? 'assistant' : null);
      const reopenSummary = notificationModeRef.current === 'persistent'
        && reopenSummaryRef.current;
      setPinnedIdentity(nextSource === 'island' && !reopenSummary ? event.payload?.identity ?? null : null);
      setStatusAnim(nextSource === 'island' ? 'grow' : null);
      setAssistantAnim(nextSource === 'nowly' ? 'grow' : null);
      setOpen(true);
    }).then(keep);
    void listen<{ generation?: number; hideAfterCollapse?: boolean; collapseToSummary?: boolean } | null>('status-island-details-close', event => {
      const generation = event?.payload?.generation;
      if (generation !== undefined) {
        if (generation < transitionGeneration.current) return;
        transitionGeneration.current = generation;
      }
      closingGeneration.current = generation ?? null;
      const closingAssistant = nativeSource.current === 'nowly';
      setAssistantClosing(closingAssistant && assistantSurfaceRef.current === 'assistant');
      setNativeHidePending(event?.payload?.hideAfterCollapse === true);
      if (!closingAssistant) {
        setCollapsedNotificationKey(
          event?.payload?.collapseToSummary === true ? unseenNotificationKeyRef.current : null
        );
        setPinnedIdentity(null);
      }
      setStatusAnim(closingAssistant ? null : 'shrink');
      if (closingAssistant) setAssistantAnim('shrink');
      setOpen(false);
      assistantSheetRequested.current = false;
      if (closingAssistant) setAssistantSurface(null);
    }).then(keep);
    void listen<{ generation: number }>('status-island-details-closed', event => {
      if (closingGeneration.current !== event.payload.generation) return;
      closingGeneration.current = null;
      setStatusAnim(null);
      if (assistantSurfaceRef.current === null) setAssistantAnim(null);
      setAssistantClosing(false);
    }).then(keep);
    return () => { disposed = true; removers.forEach(remove => remove()); };
  }, []);

  useEffect(() => () => {
    if (lastPresence.current) reportPresence('island', false);
    reportPresence('details', false);
  }, []);

  useEffect(() => {
    if (!open) return;
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      const active = document.activeElement;
      if (
        lastStatusActivationSource.current === 'pointer'
        && active instanceof HTMLElement
        && active.matches('.status-island__trigger')
      ) {
        active.blur();
      }
      lastStatusActivationSource.current = null;
      collapse();
    }
    document.addEventListener('keydown', dismissOnEscape);
    return () => document.removeEventListener('keydown', dismissOnEscape);
  }, [open, collapse]);

  const hoverStart = useCallback(() => {
    // A drag is a move, not a hover: the sheet is the rail grown, so it must not
    // open while the rail is being moved out from under the pointer.
    if (drag.dragging || assistantSheetRequested.current || assistantSurface !== null || assistantClosing) return;
    lastPresence.current = true;
    reportPresence('island', true);
    // Native waits 300ms before opening, so a quick pass neither opens the sheet
    // nor acknowledges anything.
    void invoke('hover_status_island_details');
  }, [assistantClosing, assistantSurface, drag.dragging]);

  const hoverEnd = useCallback(() => {
    lastPresence.current = false;
    reportPresence('island', false);
  }, []);

  const grabStart = useCallback((event: React.PointerEvent) => {
    lastPresence.current = false;
    reportPresence('island', false);
    drag.onGrab(event);
  }, [drag]);

  const activate = useCallback((activationSource: 'pointer' | 'keyboard') => {
    // Releasing a drag over the rail still fires a click. That click is the end
    // of the move, not a request to open anything.
    if (drag.consumedClick()) return;
    lastStatusActivationSource.current = activationSource;
    void invoke('toggle_status_island_details', { identity: primaryIdentity });
  }, [drag, primaryIdentity]);

  const activateNowly = useCallback(() => {
    if (drag.consumedClick()) return;
    if (assistantSurface === 'assistant' || (open && source === 'nowly')) {
      collapse();
      return;
    }
    if (assistantSheetRequested.current) return;
    assistantSheetRequested.current = true;
    void invoke('toggle_nowly_panel').catch(() => {
      assistantSheetRequested.current = false;
    });
  }, [assistantSurface, collapse, drag, open, source]);

  const closeAssistant = useCallback(() => {
    collapse();
  }, [collapse]);

  // Each app button calls its own command. A rejection is reported on the button
  // that failed, not as a toast, and clears on the next attempt.
  const [barButtonErrors, setBarButtonErrors] = useState<Partial<Record<BarAppId, string>>>({});
  const pendingBarButtons = useRef(new Set<BarAppId>());
  const [barButtonPending, setBarButtonPending] = useState<Partial<Record<BarAppId, boolean>>>({});
  const activateBarButton = useCallback((id: BarAppId) => {
    if (drag.consumedClick() || pendingBarButtons.current.has(id)) return;
    pendingBarButtons.current.add(id);
    setBarButtonPending(current => ({ ...current, [id]: true }));
    setBarButtonErrors(current => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    void invoke(BAR_BUTTON_COMMANDS[id]).catch((reason: unknown) => {
      setBarButtonErrors(current => ({ ...current, [id]: barButtonErrorMessage(reason) }));
    }).finally(() => {
      pendingBarButtons.current.delete(id);
      setBarButtonPending(current => ({ ...current, [id]: false }));
    });
  }, [drag]);

  const focusEnter = useCallback(() => reportPresence('keyboard', true), []);
  const focusLeave = useCallback(() => reportPresence('keyboard', false), []);

  const surface = {
    onActivate: activate,
    onHoverStart: hoverStart,
    onHoverEnd: hoverEnd,
    onFocusEnter: focusEnter,
    onFocusLeave: focusLeave,
    onGrab: grabStart,
    onNudge: drag.nudge,
    dragging: drag.dragging,
    expanded: open && source === 'island'
  };
  const retry = status === 'error' ? { onRetryStatus: () => void refresh() } : {};
  const railSurface: RailSurface = assistantSurface ?? 'status';

  const context = useMemo(() => {
    if (displayedSurface.mode === 'summary') {
      return model.summaryPanelContext;
    }
    if (pinnedIdentity === null) return model.panelContext;
    // Resolved from every reminder, not just the queue, so the pinned subject
    // survives its own reminder being hidden. Only a reminder that no longer
    // exists at all (task completed, event deleted) falls back to live context.
    return reminderPanelContext(pinnedReminder ?? undefined, model.indicatorState.focus) ?? model.panelContext;
  }, [displayedSurface.mode, model, pinnedIdentity, pinnedReminder]);

  // The live capsule may advance immediately, but the fading body must keep
  // the detail that was actually open. Its wrapper is already inert on close.
  const outgoingContext = useRef(context);
  useEffect(() => {
    if (open && source === 'island') outgoingContext.current = context;
  }, [context, open, source]);
  const panelContext = statusAnim === 'shrink' ? outgoingContext.current : context;

  const acknowledgeEvent = useCallback(async (event: { id: string; occurrenceStartAt: string | null; startAt: string }) => {
    const reminder = model.reminders.find(candidate =>
      candidate.lifecycle === 'unseen'
      && candidate.subject.kind === 'event'
      && candidate.subject.event.id === event.id
      && candidate.subject.event.occurrenceStartAt === event.occurrenceStartAt
      && candidate.subject.event.startAt === event.startAt);
    if (reminder) {
      await invoke('acknowledge_status_island_reminder', { identity: reminder.identity });
    }
  }, [model.reminders]);

  const acknowledgeTask = useCallback(async (id: string) => {
    const reminder = model.reminders.find(candidate =>
      candidate.lifecycle === 'unseen'
      && candidate.subject.kind === 'task'
      && candidate.subject.task.id === id);
    if (reminder) {
      await invoke('acknowledge_status_island_reminder', { identity: reminder.identity });
    }
  }, [model.reminders]);

  const dismissTaskReminder = useCallback(async (identity: string | null) => {
    if (identity) {
      await invoke('dismiss_status_island_reminder', { identity });
    }
  }, []);

  return (
    <main
      className="screen-status-island-root"
      aria-label={t('statusIsland.rootLabel')}
      onMouseEnter={() => reportPresence('details', true)}
      onMouseLeave={() => reportPresence('details', false)}
    >
      <TopRail
        open={open}
        source={source}
        surface={railSurface}
        assistantClosing={assistantClosing}
        statusAnim={statusAnim}
        assistantAnim={assistantAnim}
        mode={displayedSurface.mode}
        barButtons={barButtons}
        barButtonErrors={barButtonErrors}
        barButtonPending={barButtonPending}
        onActivateBarButton={activateBarButton}
        onCollapse={collapse}
        onActivateNowly={activateNowly}
        assistant={(
          <AssistantDock
            active={assistantSurface !== null}
            onRefresh={refresh}
          />
        )}
        panel={(
          <StatusIslandPanel
            compact
            context={panelContext}
            actions={{
              onOpenEvent: event => void withActionHold(async () => {
                await acknowledgeEvent(event);
                await invoke('open_status_island_event', {
                  target: { id: event.id, occurrenceStartAt: event.occurrenceStartAt },
                  startAt: event.startAt
                });
              }),
              onOpenTask: id => void withActionHold(async () => {
                await acknowledgeTask(id);
                await invoke('open_status_island_task', { id });
              }),
              onStartFocus: () => void withActionHold(() => invoke('start_status_island_focus', { minutes: 25 })),
              onPauseFocus: () => void withActionHold(() => invoke('pause_status_island_focus')),
              onResumeFocus: () => void withActionHold(() => invoke('resume_status_island_focus')),
              onEndFocus: () => void withActionHold(() => invoke('cancel_focus_timer')),
              onCompleteTask: id => void withActionHold(async () => {
                const reminderIdentity = model.reminders.find(candidate =>
                  candidate.subject.kind === 'task'
                  && candidate.subject.task.id === id)?.identity ?? null;
                await invoke('set_task_completed', { id, completed: true });
                await dismissTaskReminder(reminderIdentity);
                await invoke('close_status_island_details');
              })
              // No retry here: the head carries it, and the head is the one part
              // of the rail that is visible at both sizes. A second copy inside
              // the sheet would report the same failure twice.
            }}
          />
        )}
      >
        {displayedSurface.mode === 'detail' ? (
          <StatusIslandReminderView
            reminder={displayedSurface.reminder}
            markers={model.indicatorState.markers}
            // Closing a detail is not hiding the surface: it downgrades this one
            // reminder to the summary, which stays on screen.
            onDismiss={() => void invoke('dismiss_status_island_reminder', { identity: displayedSurface.reminder.identity })}
            {...retry}
            {...surface}
          />
        ) : displayedSurface.mode === 'summary' ? (
          <StatusIslandSummaryView summary={displayedSurface.summary} {...retry} {...surface} />
        ) : (
          <StatusIslandIdleView {...retry} {...surface} />
        )}
      </TopRail>
    </main>
  );
}

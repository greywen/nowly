import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NowlyPanel,
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

// The top rail window. It is the *only* floating window: the sheet is the
// capsule grown, and a native window cannot grow into another one, so the panel
// that used to live in `status-island-details` is rendered here.
//
// Native owns whether the sheet is open, because it also owns the window size,
// the 300ms hover delay and the acknowledgement that goes with opening. This
// component follows the open/close events rather than holding its own opinion.

type PanelSource = 'island' | 'nowly';

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
  const { model, status, refresh } = useStatusIslandSnapshot();
  const drag = useStatusIslandDrag();
  const surfaceState = model.surface;
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<PanelSource>('island');
  // Null until the first transition, so the rail does not animate itself into
  // existence on mount.
  const [anim, setAnim] = useState<'grow' | 'shrink' | null>(null);
  // The sheet is opened *for* one reminder and stays pinned to it by identity.
  // It must not follow the live queue head: once the shown reminder is hidden the
  // head becomes the next reminder, and an unpinned sheet would silently swap its
  // content — and what its action buttons act on — under the user.
  const [pinnedIdentity, setPinnedIdentity] = useState<string | null>(null);
  // Native records acknowledgement against whatever the capsule is showing. In
  // summary and idle mode it is showing no single reminder, so there is nothing
  // to acknowledge.
  const primaryIdentity = surfaceState.mode === 'detail' ? surfaceState.reminder.identity : null;
  const lastPresence = useRef(false);

  useEffect(() => {
    void invoke('set_status_island_primary', { identity: primaryIdentity });
  }, [primaryIdentity]);

  useEffect(() => {
    const removers: Array<() => void> = [];
    let disposed = false;
    const keep = (remove: () => void) => disposed ? remove() : removers.push(remove);
    void listen<{ source: PanelSource; identity: string | null } | null>('status-island-details-open', event => {
      setSource(event.payload?.source ?? 'island');
      setPinnedIdentity(event.payload?.identity ?? null);
      setAnim('grow');
      setOpen(true);
    }).then(keep);
    void listen('status-island-details-close', () => {
      setPinnedIdentity(null);
      setAnim('shrink');
      setOpen(false);
    }).then(keep);
    return () => { disposed = true; removers.forEach(remove => remove()); };
  }, []);

  useEffect(() => () => {
    if (lastPresence.current) reportPresence('island', false);
    reportPresence('details', false);
  }, []);

  const collapse = useCallback(() => void invoke('close_status_island_details'), []);

  useEffect(() => {
    if (!open) return;
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') collapse();
    }
    document.addEventListener('keydown', dismissOnEscape);
    return () => document.removeEventListener('keydown', dismissOnEscape);
  }, [open, collapse]);

  const hoverStart = useCallback(() => {
    // A drag is a move, not a hover: the sheet is the rail grown, so it must not
    // open while the rail is being moved out from under the pointer.
    if (drag.dragging) return;
    lastPresence.current = true;
    reportPresence('island', true);
    // Native waits 300ms before opening, so a quick pass neither opens the sheet
    // nor acknowledges anything.
    void invoke('hover_status_island_details');
  }, [drag.dragging]);

  const hoverEnd = useCallback(() => {
    lastPresence.current = false;
    reportPresence('island', false);
  }, []);

  const activate = useCallback(() => {
    // Releasing a drag over the rail still fires a click. That click is the end
    // of the move, not a request to open anything.
    if (drag.consumedClick()) return;
    void invoke('toggle_status_island_details');
  }, [drag]);

  const activateNowly = useCallback(() => {
    if (drag.consumedClick()) return;
    void invoke('toggle_nowly_panel');
  }, [drag]);

  const focusEnter = useCallback(() => reportPresence('keyboard', true), []);
  const focusLeave = useCallback(() => reportPresence('keyboard', false), []);

  const surface = {
    onActivate: activate,
    onHoverStart: hoverStart,
    onHoverEnd: hoverEnd,
    onFocusEnter: focusEnter,
    onFocusLeave: focusLeave,
    onGrab: drag.onGrab,
    onNudge: drag.nudge,
    dragging: drag.dragging,
    expanded: open && source === 'island'
  };
  const retry = status === 'error' ? { onRetryStatus: () => void refresh() } : {};

  const context = useMemo(() => {
    if (pinnedIdentity === null) return model.panelContext;
    // Resolved from every reminder, not just the queue, so the pinned subject
    // survives its own reminder being hidden. Only a reminder that no longer
    // exists at all (task completed, event deleted) falls back to live context.
    const pinned = model.reminders.find(reminder => reminder.identity === pinnedIdentity);
    return reminderPanelContext(pinned, model.indicatorState.focus) ?? model.panelContext;
  }, [model, pinnedIdentity]);

  return (
    <main
      className="screen-status-island-root"
      aria-label="Nowly 状态岛"
      // Real pointer presence only. "Sheet is open" is a separate hold, tracked
      // natively, so that a hover-opened sheet can still close when the pointer
      // leaves without openness masquerading as a pointer.
      onMouseEnter={() => reportPresence('details', true)}
      onMouseLeave={() => reportPresence('details', false)}
    >
      <TopRail
        open={open}
        source={source}
        anim={anim}
        mode={surfaceState.mode}
        onCollapse={collapse}
        nowly={{
          onActivate: activateNowly,
          onGrab: drag.onGrab,
          onNudge: drag.nudge,
          dragging: drag.dragging,
          expanded: open && source === 'nowly'
        }}
        panel={source === 'nowly' ? <NowlyPanel /> : (
          <StatusIslandPanel
            compact
            context={context}
            actions={{
              onOpenEvent: event => void withActionHold(() => invoke('open_status_island_event', {
                target: { id: event.id, occurrenceStartAt: event.occurrenceStartAt },
                startAt: event.startAt
              })),
              onOpenTask: id => void withActionHold(() => invoke('open_status_island_task', { id })),
              onStartFocus: () => void withActionHold(() => invoke('start_status_island_focus', { minutes: 25 })),
              onPauseFocus: () => void withActionHold(() => invoke('pause_status_island_focus')),
              onResumeFocus: () => void withActionHold(() => invoke('resume_status_island_focus')),
              onEndFocus: () => void withActionHold(() => invoke('cancel_focus_timer')),
              onCompleteTask: id => void withActionHold(() => invoke('set_task_completed', { id, completed: true }))
              // No retry here: the head carries it, and the head is the one part
              // of the rail that is visible at both sizes. A second copy inside
              // the sheet would report the same failure twice.
            }}
          />
        )}
      >
        {surfaceState.mode === 'detail' ? (
          <StatusIslandReminderView
            reminder={surfaceState.reminder}
            markers={model.indicatorState.markers}
            // Closing a detail is not hiding the surface: it downgrades this one
            // reminder to the summary, which stays on screen.
            onDismiss={() => void invoke('dismiss_status_island_reminder', { identity: surfaceState.reminder.identity })}
            {...retry}
            {...surface}
          />
        ) : surfaceState.mode === 'summary' ? (
          <StatusIslandSummaryView summary={surfaceState.summary} {...retry} {...surface} />
        ) : (
          <StatusIslandIdleView {...retry} {...surface} />
        )}
      </TopRail>
    </main>
  );
}

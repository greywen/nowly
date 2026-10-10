import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  buildDefinitions,
  type WidgetId
} from '../widgets/widget-registry';
import { CalendarWidget } from '../calendar/CalendarWidget';
import { useEvents } from '../calendar/useEvents';
import { useCategories } from '../calendar/useCategories';
import type { ModalState } from '../lib/modal-store';
import { externalToCalendarEvent, type CalendarSubscription } from '../calendar/subscription-model';
import { isEventWritable, type EventTarget } from '../calendar/calendar-model';
import { enterForegroundMode, enterWallpaperMode } from '../lib/window-mode';
import { MatrixWidget } from '../matrix/MatrixWidget';
import { KanbanWidget } from '../kanban/KanbanWidget';
import { TaskWorkspaceProvider } from '../tasks/TaskWorkspaceContext';
import { IconStyleProvider } from '../components/icons';
import { useWorkspaceTasks } from '../tasks/useWorkspaceTasks';
import { ModalRoot } from '../modals/ModalRoot';
import { NotesWidget } from '../notes/NotesWidget';
import { useNotes } from '../notes/useNotes';
import { useNotesView } from '../notes/useNotesView';
import { DesktopShell } from './layout/DesktopShell';
import { useSettings } from '../settings/useSettings';
import { useRecentColors } from '../settings/useRecentColors';
import { useUpdateCheck } from '../settings/useUpdateCheck';
import { useNowlyRepository } from '../data/RepositoryContext';
import { useCurrentTime } from './useCurrentTime';
import { t, useTranslation, getLanguage } from '../i18n';
import { FocusTimerWidget } from '../focus/FocusTimerWidget';
import { useFocusTimer } from '../focus/FocusTimerContext';
import { FocusStatisticsDialog } from '../focus/FocusStatisticsDialog';
import { FocusWallpaperOverlay } from '../focus/FocusWallpaperOverlay';
import { OnboardingGuide, type GuideStep } from './onboarding/OnboardingGuide';
import { useOnboarding } from './onboarding/useOnboarding';
import type { NativeStatusIslandSnapshot } from '../quick-panel/useStatusIslandSnapshot';

type WindowMode = 'wallpaper' | 'foreground';

function localeTag() {
  return getLanguage() === 'en' ? 'en-US' : 'zh-CN';
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function AppContent() {
  useTranslation();
  const repository = useNowlyRepository();
  const settingsFeature = useSettings();
  const eventsFeature = useEvents({ weekStart: settingsFeature.settings.data.weekStart });
  const categoriesFeature = useCategories();
  const tasksFeature = useWorkspaceTasks();
  const notesFeature = useNotes();
  const notesView = useNotesView();
  const refreshEvents = useCallback(() => eventsFeature.retryEvents(), [eventsFeature]);
  const events = eventsFeature.events.data;
  const tasks = tasksFeature.tasks.data;
  const notes = notesFeature.notes.data;
  const [modal, setModal] = useState<ModalState>(null);
  const [subscriptions, setSubscriptions] = useState<CalendarSubscription[]>([]);
  const loadSubscriptions = useCallback(() => {
    void repository.listCalendarSubscriptions().then(setSubscriptions).catch(() => setSubscriptions([]));
  }, [repository]);
  // After a subscription is created, edited, deleted, or manually refreshed the
  // external_events table may have changed, so reload both the source list and
  // the calendar events; otherwise removed/updated events linger until the next
  // range change or the ~1-minute background poll.
  const onSubscriptionsChanged = useCallback(() => {
    loadSubscriptions();
    void refreshEvents();
  }, [loadSubscriptions, refreshEvents]);
  // Refresh every configured subscription in turn, then reload the source list
  // and calendar events so freshly synced items appear at once. Individual
  // failures are ignored so one broken source can't block the rest.
  const syncAllSubscriptions = useCallback(async () => {
    await Promise.all(
      subscriptions.map((subscription) =>
        repository.refreshCalendarSubscription(subscription.id).catch(() => undefined)
      )
    );
    onSubscriptionsChanged();
  }, [subscriptions, repository, onSubscriptionsChanged]);
  const [focusStatisticsOpen, setFocusStatisticsOpen] = useState(false);
  const [windowMode, setWindowMode] = useState<WindowMode>('foreground');
  const [isSwitchingWindowMode, setIsSwitchingWindowMode] = useState(false);
  const isSwitchingWindowModeRef = useRef(false);
  const focusTimer = useFocusTimer();
  const focusStatus = focusTimer.state.status;

  const onboarding = useOnboarding();
  const update = useUpdateCheck();

  const now = useCurrentTime();
  const todayIso = localIsoDate(now);
  const { recentColors, rememberColor: rememberCustomColor } = useRecentColors();

  // Interface density is a global visual preference: it drives the spacing
  // scale for the whole app, modals included. We reflect it as a data attribute
  // on the document root so CSS can tighten (compact) or widen (comfortable)
  // paddings and gaps without threading the value through every view. The
  // balanced default needs no overrides.
  const density = settingsFeature.settings.data.density;
  useEffect(() => {
    document.documentElement.dataset.density = density;
    return () => {
      delete document.documentElement.dataset.density;
    };
  }, [density]);

  // When a focus session finishes, briefly show the "done" state and then
  // clear it back to idle. Completion only surfaces a system notification; it
  // must never pull Nowly from wallpaper to the foreground. Resetting is what
  // clears the overlay: the fullscreen countdown only renders while the
  // session is running/paused/completed, so returning to idle removes it and
  // leaves the wallpaper clean without any window-mode switch.
  useEffect(() => {
    if (focusStatus !== 'completed') return;
    const id = window.setTimeout(() => {
      focusTimer.reset();
    }, 2500);
    return () => window.clearTimeout(id);
  }, [focusStatus, windowMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // The full set of placeable modules. Every module Nowly offers is built in.
  const definitions = buildDefinitions();

  const todayEventCount = events.filter((event) => event.startAt.startsWith(todayIso)).length;
  const importantTaskCount = tasks.filter(
    (task) => !task.completed && task.quadrant.startsWith('important')
  ).length;
  const summary = t('app.summary', { events: todayEventCount, tasks: importantTaskCount, notes: notes.length });
  const modules: Partial<Record<WidgetId, ReactNode>> = {};
  {
    modules.calendar = (
      <CalendarWidget
        year={eventsFeature.year}
        monthIndex={eventsFeature.monthIndex}
        todayIso={todayIso}
        events={events}
        categories={categoriesFeature.categories}
        status={eventsFeature.events.status}
        errorMessage={eventsFeature.events.status === 'error' ? eventsFeature.events.message : undefined}
        view={eventsFeature.view}
        anchorIso={eventsFeature.anchorIso}
        onRetry={() => void eventsFeature.retryEvents()}
        onCreateEvent={() => openModalInForeground({ type: 'event-create', dateIso: todayIso, trigger: null })}
        onSetView={eventsFeature.setView}
        onPreviousMonth={eventsFeature.goToPrevious}
        onNextMonth={eventsFeature.goToNext}
        onToday={eventsFeature.goToToday}
        onCreateEventForDate={(dateIso) => openModalInForeground({ type: 'event-create', dateIso, trigger: null })}
        onOpenDate={(isoDate) => openModalInForeground({ type: 'date', isoDate, trigger: null })}
        onOpenEvent={(event) =>
          event.subscriptionId && !isEventWritable(event)
            ? openModalInForeground({ type: 'external-detail', event, trigger: null })
            : openModalInForeground({ type: 'event-edit', event, trigger: null })
        }
        onMoveEvent={(event, isoDate) => void eventsFeature.moveEvent(event, isoDate)}
        onMoveEventToHour={(event, isoDate, startHour) => void eventsFeature.moveEventToHour(event, isoDate, startHour)}
        onResizeEvent={(event, endIsoDate) => void eventsFeature.resizeEvent(event, endIsoDate)}
        calendarSettings={{
          weekStart: settingsFeature.settings.data.weekStart,
          dateFormat: settingsFeature.settings.data.dateFormat,
          showWeekends: settingsFeature.settings.data.showWeekends
        }}
        onOpenSettings={() => openModalInForeground({ type: 'calendar-settings', trigger: null })}
        hasSubscriptions={subscriptions.length > 0}
        onSyncSubscriptions={syncAllSubscriptions}
      />
    );
  }
  {
    modules.matrix = (
      <MatrixWidget
        tasks={tasks}
        status={tasksFeature.tasks.status}
        errorMessage={tasksFeature.tasks.status === 'error' ? tasksFeature.tasks.message : undefined}
        completionError={tasksFeature.failedCompletion?.message ?? null}
        dragError={tasksFeature.dragError}
        pendingTaskIds={tasksFeature.pendingTaskIds}
        onRetry={() => void tasksFeature.retryTasks()}
        onCreateTask={() => openModalInForeground({ type:'task-create', dueDate:null, trigger:null })}
        onOpenSettings={() => openModalInForeground({ type:'task-settings', trigger:null })}
        onOpenTask={(task, trigger) => openModalInForeground({ type:'task-edit', task, trigger })}
        onToggleTask={(task, completed) => void tasksFeature.setTaskCompleted(task, completed)}
        onMoveTask={(task, quadrant) => void tasksFeature.moveTask(task, quadrant)}
        onRetryCompletion={() => void tasksFeature.retryFailedCompletion()}
        onDismissCompletionError={tasksFeature.dismissTaskError}
        onDismissDragError={tasksFeature.dismissDragError}
      />
    );
  }
  {
    modules.notes = (
      <NotesWidget
        notes={notes}
        status={notesFeature.notes.status}
        errorMessage={notesFeature.notes.status === 'error' ? notesFeature.notes.message : undefined}
        view={notesView.view}
        onSetView={notesView.setView}
        onRetry={() => void notesFeature.retryNotes()}
        onCreateNote={() => openModalInForeground({type:'note-create',trigger:null})}
        onOpenNote={(note,trigger) => openModalInForeground({type:'note-edit',note,trigger})}
        onViewAll={(trigger) => openModalInForeground({type:'notes-manager',trigger})}
      />
    );
  }
  modules.kanban = (
    <KanbanWidget
      todayIso={todayIso}
      recentColors={recentColors}
      onRememberCustomColor={rememberCustomColor}
    />
  );
  modules.focusTimer = <FocusTimerWidget mode={windowMode} onOpenStatistics={() => setFocusStatisticsOpen(true)} onEnterWallpaper={() => void runWindowModeSwitch(switchToWallpaper)} />;


  useEffect(() => {
    const removers: Array<() => void> = [];
    void listen<WindowMode>('window-mode-changed', (event) => setWindowMode(event.payload)).then(remove => removers.push(remove));
    void listen('open-settings', () => setModal({type:'settings',trigger:null})).then(remove => removers.push(remove));
    void listen('request-overlay-cleanup', () => setModal(null)).then(remove => removers.push(remove));
    void listen('calendar-subscriptions-updated', () => { loadSubscriptions(); void refreshEvents(); }).then(remove => removers.push(remove));
    void listen<{ target: EventTarget; startAt: string }>('status-island-open-event', event => {
      void invoke<NativeStatusIslandSnapshot>('get_status_island_snapshot').then(snapshot => {
        const candidates = [...snapshot.events, ...snapshot.externalEvents.map(externalToCalendarEvent)];
        const selected = candidates.find(item => item.id === event.payload.target.id
          && (event.payload.target.occurrenceStartAt !== null
            ? item.occurrenceStartAt === event.payload.target.occurrenceStartAt
            : item.startAt === event.payload.startAt));
        if (!selected) return;
        openModalInForeground(selected.subscriptionId && !isEventWritable(selected)
          ? { type: 'external-detail', event: selected, trigger: null }
          : { type: 'event-edit', event: selected, trigger: null });
      }).catch(() => undefined);
    }).then(remove => removers.push(remove));
    void listen<string>('status-island-open-task', event => {
      void invoke<NativeStatusIslandSnapshot>('get_status_island_snapshot').then(snapshot => {
        const task = snapshot.tasks.find(item => item.id === event.payload);
        if (task) openModalInForeground({ type: 'workspace-task-edit', task, trigger: null });
      }).catch(() => undefined);
    }).then(remove => removers.push(remove));
    return () => removers.forEach(remove => remove());
  }, [loadSubscriptions, refreshEvents]);

  useEffect(() => { loadSubscriptions(); }, [loadSubscriptions]);

  async function runWindowModeSwitch(switchMode: () => Promise<void>) {
    if (isSwitchingWindowModeRef.current) return;

    isSwitchingWindowModeRef.current = true;
    setIsSwitchingWindowMode(true);
    try {
      await switchMode();
    } finally {
      isSwitchingWindowModeRef.current = false;
      setIsSwitchingWindowMode(false);
    }
  }

  async function switchToForeground() {
    await enterForegroundMode();
    setWindowMode('foreground');
  }

  async function switchToWallpaper() {
    await enterWallpaperMode();
    setWindowMode('wallpaper');
  }

  function openModalInForeground(nextModal: ModalState) {
    runWindowModeSwitch(async () => {
      if (windowMode === 'wallpaper') {
        await switchToForeground().catch(() => undefined);
      }
      setModal(nextModal);
    }).catch(() => undefined);
  }

  const onboardingSteps: GuideStep[] = [
    { title: t('onboarding.welcome.title'), body: t('onboarding.welcome.body') },
    { target: 'workspace', title: t('onboarding.workspace.title'), body: t('onboarding.workspace.body') },
    { target: 'edit-layout', title: t('onboarding.editLayout.title'), body: t('onboarding.editLayout.body') },
    { target: 'settings', title: t('onboarding.settings.title'), body: t('onboarding.settings.body') },
    { target: 'wallpaper', title: t('onboarding.wallpaper.title'), body: t('onboarding.wallpaper.body') },
    { title: t('onboarding.done.title'), body: t('onboarding.done.body') }
  ];

  return (
    <IconStyleProvider style={settingsFeature.settings.data.iconStyle}>
      <DesktopShell
        mode={windowMode}
        time={new Intl.DateTimeFormat(localeTag(), { hour: '2-digit', minute: '2-digit', hour12: false }).format(now)}
        dateText={new Intl.DateTimeFormat(localeTag(), { dateStyle: 'full' }).format(now)}
        summary={summary}
        modules={modules}
        definitions={definitions}
        isModeSwitching={isSwitchingWindowMode}
        onSetWallpaper={() => void runWindowModeSwitch(switchToWallpaper)}
        onWallpaperDoubleClick={() => void runWindowModeSwitch(switchToForeground)}
        onOpenSettings={() => setModal({type:'settings',trigger:null})}
        hideTopbarInWallpaper={settingsFeature.settings.data.hideTopbarInWallpaper}
        overlay={windowMode === 'wallpaper' ? <FocusWallpaperOverlay /> : null}
        update={update}
      />
      {focusStatisticsOpen ? <FocusStatisticsDialog onClose={() => setFocusStatisticsOpen(false)} /> : null}
      <OnboardingGuide
        open={onboarding.shouldShow && windowMode === 'foreground'}
        steps={onboardingSteps}
        onClose={onboarding.dismiss}
      />
      <ModalRoot
        modal={modal}
        events={events}
        onClose={() => setModal(null)}
        onChangeModal={setModal}
        createEvent={eventsFeature.createEvent}
        updateEvent={eventsFeature.updateEvent}
        deleteEvent={eventsFeature.deleteEvent}
        onSaved={() => undefined}
        onDeleted={() => undefined}
        notes={notes}
        createNote={notesFeature.createNote}
        updateNote={notesFeature.updateNote}
        deleteNote={notesFeature.deleteNote}
        settings={settingsFeature.settings.data}
        monitors={settingsFeature.monitors.data}
        saveSettings={settingsFeature.saveSettings}
        subscriptions={subscriptions}
        onSubscriptionsChanged={onSubscriptionsChanged}
        createSubscription={repository.createCalendarSubscription}
        updateSubscription={repository.updateCalendarSubscription}
        deleteSubscription={repository.deleteCalendarSubscription}
        refreshSubscription={repository.refreshCalendarSubscription}
        categories={categoriesFeature.categories}
        createCategory={categoriesFeature.createCategory}
        updateCategory={categoriesFeature.updateCategory}
        deleteCategory={categoriesFeature.deleteCategory}
        recentColors={recentColors}
        onRememberCustomColor={rememberCustomColor}
      />
    </IconStyleProvider>
  );
}

export function App() {
  return (
    <TaskWorkspaceProvider>
      <AppContent />
    </TaskWorkspaceProvider>
  );
}

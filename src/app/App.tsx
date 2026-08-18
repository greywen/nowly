import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  buildDefinitions,
  getWidgetDefinition,
  type WidgetId
} from '../widgets/widget-registry';
import { CalendarWidget } from '../calendar/CalendarWidget';
import { useEvents } from '../calendar/useEvents';
import type { ModalState } from '../lib/modal-store';
import { enterForegroundMode, enterWallpaperMode } from '../lib/window-mode';
import { MatrixWidget } from '../matrix/MatrixWidget';
import { useTasks } from '../matrix/useTasks';
import { KanbanWidget } from '../kanban/KanbanWidget';
import { ModalRoot } from '../modals/ModalRoot';
import { NotesWidget } from '../notes/NotesWidget';
import { useNotes } from '../notes/useNotes';
import { DesktopShell } from './layout/DesktopShell';
import { useSettings } from '../settings/useSettings';
import { useRecentColors } from '../settings/useRecentColors';
import { useExtensions } from '../widgets/useExtensions';
import { getExtensionComponent } from '../widgets/extension-modules';
import { createModuleHost } from '../widgets/extension-module';
import { SandboxModule } from '../widgets/sandbox/SandboxModule';
import { SANDBOX_ID_PREFIX } from '../widgets/widget-registry';
import { useNowlyRepository } from '../data/RepositoryContext';
import { useCurrentTime } from './useCurrentTime';
import { t, useTranslation, getLanguage } from '../i18n';
import { FocusTimerWidget } from '../focus/FocusTimerWidget';
import { useFocusTimer } from '../focus/FocusTimerContext';
import { FocusStatisticsDialog } from '../focus/FocusStatisticsDialog';
import { FocusWallpaperOverlay } from '../focus/FocusWallpaperOverlay';
import { OnboardingGuide, type GuideStep } from './onboarding/OnboardingGuide';
import { useOnboarding } from './onboarding/useOnboarding';

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

export function App() {
  useTranslation();
  const repository = useNowlyRepository();
  const settingsFeature = useSettings();
  const refreshTasksRef = useRef<() => Promise<unknown>>(async () => undefined);
  const refreshEventsRef = useRef<() => Promise<unknown>>(async () => undefined);
  const refreshTasks = useCallback(() => refreshTasksRef.current(), []);
  const refreshEvents = useCallback(() => refreshEventsRef.current(), []);
  const eventsFeature = useEvents({ onRefreshTasks: refreshTasks, weekStart: settingsFeature.settings.data.weekStart });
  const tasksFeature = useTasks({ onRefreshEvents: refreshEvents });
  const notesFeature = useNotes();
  const extensionsFeature = useExtensions();
  refreshTasksRef.current = tasksFeature.retryTasks;
  refreshEventsRef.current = eventsFeature.retryEvents;
  const events = eventsFeature.events.data;
  const tasks = tasksFeature.tasks.data;
  const notes = notesFeature.notes.data;
  const [modal, setModal] = useState<ModalState>(null);
  const [focusStatisticsOpen, setFocusStatisticsOpen] = useState(false);
  const [windowMode, setWindowMode] = useState<WindowMode>('foreground');
  const [isSwitchingWindowMode, setIsSwitchingWindowMode] = useState(false);
  const isSwitchingWindowModeRef = useRef(false);
  const focusTimer = useFocusTimer();
  const focusStatus = focusTimer.state.status;

  const onboarding = useOnboarding();

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

  // When a focus session finishes while the app is running as the fullscreen
  // wallpaper, briefly show the "done" state and then return to the foreground
  // on its own, so the desktop is never left stuck behind the overlay.
  useEffect(() => {
    if (focusStatus !== 'completed' || windowMode !== 'wallpaper') return;
    const id = window.setTimeout(() => {
      void runWindowModeSwitch(switchToForeground);
    }, 2500);
    return () => window.clearTimeout(id);
  }, [focusStatus, windowMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // The full set of placeable modules: built-ins, extensions, and installed
  // user modules.
  const definitions = buildDefinitions(extensionsFeature.extensions);

  // Build a stable host per extension module, rebuilt only when the day rolls
  // over. Each module talks to the app only through this host (identity, today,
  // its own persisted state) — the same contract a sandboxed extension would use.
  const hostCache = useRef(new Map<string, ReturnType<typeof createModuleHost>>());
  const hostDayRef = useRef(todayIso);
  if (hostDayRef.current !== todayIso) {
    hostDayRef.current = todayIso;
    hostCache.current.clear();
  }
  const hostFor = (id: string, allowedHosts: string[] = []) => {
    let host = hostCache.current.get(id);
    if (!host) {
      host = createModuleHost(repository, id, todayIso, allowedHosts);
      hostCache.current.set(id, host);
    }
    return host;
  };
  const renderExtension = (id: string): ReactNode => {
    // Native (in-app) extension component.
    const Component = getExtensionComponent(id);
    if (!Component) return undefined;
    return <Component host={hostFor(id)} />;
  };

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
        onOpenEvent={(event) => openModalInForeground({ type: 'event-edit', event, trigger: null })}
        onMoveEvent={(event, isoDate) => void eventsFeature.moveEvent(event, isoDate)}
        onMoveEventToHour={(event, isoDate, startHour) => void eventsFeature.moveEventToHour(event, isoDate, startHour)}
        onResizeEvent={(event, endIsoDate) => void eventsFeature.resizeEvent(event, endIsoDate)}
        calendarSettings={{
          weekStart: settingsFeature.settings.data.weekStart,
          dateFormat: settingsFeature.settings.data.dateFormat,
          showWeekends: settingsFeature.settings.data.showWeekends
        }}
        onChangeCalendarSettings={(next) => void settingsFeature.saveSettings({ ...settingsFeature.settings.data, ...next })}
      />
    );
  }
  {
    modules.matrix = (
      <MatrixWidget
        tasks={tasks}
        events={events}
        status={tasksFeature.tasks.status}
        errorMessage={tasksFeature.tasks.status === 'error' ? tasksFeature.tasks.message : undefined}
        completionError={tasksFeature.failedCompletion?.message ?? null}
        pendingTaskIds={tasksFeature.pendingTaskIds}
        onRetry={() => void tasksFeature.retryTasks()}
        onCreateTask={() => openModalInForeground({ type:'task-create', dueDate:null, trigger:null })}
        onOpenTask={(task, trigger) => openModalInForeground({ type:'task-edit', task, trigger })}
        onToggleTask={(task, completed) => void tasksFeature.setTaskCompleted(task, completed)}
        onRetryCompletion={() => void tasksFeature.retryFailedCompletion()}
        onDismissCompletionError={tasksFeature.dismissTaskError}
      />
    );
  }
  {
    modules.notes = (
      <NotesWidget
        notes={notes}
        status={notesFeature.notes.status}
        errorMessage={notesFeature.notes.status === 'error' ? notesFeature.notes.message : undefined}
        onRetry={() => void notesFeature.retryNotes()}
        onCreateNote={() => openModalInForeground({type:'note-create',trigger:null})}
        onOpenNote={(note,trigger) => openModalInForeground({type:'note-edit',note,trigger})}
        onViewAll={(trigger) => openModalInForeground({type:'notes-manager',trigger})}
      />
    );
  }
  modules.kanban = <KanbanWidget todayIso={todayIso} recentColors={recentColors} onRememberCustomColor={rememberCustomColor} />;
  modules.focusTimer = <FocusTimerWidget mode={windowMode} onOpenStatistics={() => setFocusStatisticsOpen(true)} onEnterWallpaper={() => void runWindowModeSwitch(switchToWallpaper)} />;
  // Installed user modules run their uploaded source in an isolated
  // iframe, gated by the permissions they declared at install time.
  for (const extension of extensionsFeature.extensions) {
    const id = `${SANDBOX_ID_PREFIX}${extension.id}`;
    modules[id] = (
      <SandboxModule
        host={hostFor(id, extension.allowedHosts)}
        source={extension.source}
        title={extension.name}
        permissions={extension.permissions}
        allowedHosts={extension.allowedHosts}
      />
    );
  }


  useEffect(() => {
    const removers: Array<() => void> = [];
    void listen<WindowMode>('window-mode-changed', (event) => setWindowMode(event.payload)).then(remove => removers.push(remove));
    void listen('open-settings', () => setModal({type:'settings',trigger:null})).then(remove => removers.push(remove));
    void listen('request-overlay-cleanup', () => setModal(null)).then(remove => removers.push(remove));
    return () => removers.forEach(remove => remove());
  }, []);

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
    <>
      <DesktopShell
        mode={windowMode}
        time={new Intl.DateTimeFormat(localeTag(), { hour: '2-digit', minute: '2-digit', hour12: false }).format(now)}
        dateText={new Intl.DateTimeFormat(localeTag(), { dateStyle: 'full' }).format(now)}
        summary={summary}
        modules={modules}
        definitions={definitions}
        sandboxExtensions={extensionsFeature.extensions}
        onInstallExtension={extensionsFeature.install}
        onUninstallExtension={extensionsFeature.uninstall}
        onReloadExtensions={() => void extensionsFeature.reload()}
        isModeSwitching={isSwitchingWindowMode}
        onSetWallpaper={() => void runWindowModeSwitch(switchToWallpaper)}
        onWallpaperDoubleClick={() => void runWindowModeSwitch(switchToForeground)}
        onOpenSettings={() => setModal({type:'settings',trigger:null})}
        overlay={windowMode === 'wallpaper' ? <FocusWallpaperOverlay /> : null}
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
        tasks={tasks}
        onClose={() => setModal(null)}
        onChangeModal={setModal}
        createEvent={eventsFeature.createEvent}
        updateEvent={eventsFeature.updateEvent}
        deleteEvent={eventsFeature.deleteEvent}
        onSaved={() => undefined}
        onDeleted={() => undefined}
        createTask={tasksFeature.createTask}
        updateTask={tasksFeature.updateTask}
        deleteTask={tasksFeature.deleteTask}
        onTaskSaved={() => undefined}
        onTaskDeleted={() => undefined}
        notes={notes}
        createNote={notesFeature.createNote}
        updateNote={notesFeature.updateNote}
        deleteNote={notesFeature.deleteNote}
        settings={settingsFeature.settings.data}
        monitors={settingsFeature.monitors.data}
        saveSettings={settingsFeature.saveSettings}
        recentColors={recentColors}
        onRememberCustomColor={rememberCustomColor}
      />
    </>
  );
}

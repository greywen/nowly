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
import { ModalRoot } from '../modals/ModalRoot';
import { NotesWidget } from '../notes/NotesWidget';
import { useNotes } from '../notes/useNotes';
import { DesktopShell } from './layout/DesktopShell';
import { useSettings } from '../settings/useSettings';
import { useExtensions } from '../widgets/useExtensions';
import { getExtensionComponent } from '../widgets/extension-modules';
import { createModuleHost } from '../widgets/extension-module';
import { SandboxModule } from '../widgets/sandbox/SandboxModule';
import { SANDBOX_ID_PREFIX } from '../widgets/widget-registry';
import { useNowlyRepository } from '../data/RepositoryContext';
import { useCurrentTime } from './useCurrentTime';

type WindowMode = 'wallpaper' | 'foreground';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' });
const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function App() {
  const repository = useNowlyRepository();
  const settingsFeature = useSettings();
  const refreshTasksRef = useRef<() => Promise<unknown>>(async () => undefined);
  const refreshEventsRef = useRef<() => Promise<unknown>>(async () => undefined);
  const refreshTasks = useCallback(() => refreshTasksRef.current(), []);
  const refreshEvents = useCallback(() => refreshEventsRef.current(), []);
  const eventsFeature = useEvents({ onRefreshTasks: refreshTasks });
  const tasksFeature = useTasks({ onRefreshEvents: refreshEvents });
  const notesFeature = useNotes();
  const extensionsFeature = useExtensions();
  refreshTasksRef.current = tasksFeature.retryTasks;
  refreshEventsRef.current = eventsFeature.retryEvents;
  const events = eventsFeature.events.data;
  const tasks = tasksFeature.tasks.data;
  const notes = notesFeature.notes.data;
  const [modal, setModal] = useState<ModalState>(null);
  const [windowMode, setWindowMode] = useState<WindowMode>('foreground');
  const [isSwitchingWindowMode, setIsSwitchingWindowMode] = useState(false);
  const isSwitchingWindowModeRef = useRef(false);

  const now = useCurrentTime();
  const todayIso = localIsoDate(now);

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
  const hostFor = (id: string) => {
    let host = hostCache.current.get(id);
    if (!host) {
      host = createModuleHost(repository, id, todayIso);
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
  const summary = `今天 ${todayEventCount} 个日程 · ${importantTaskCount} 个重要任务 · ${notes.length} 条便签`;

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
  modules.focusTimer = renderExtension('focusTimer');
  modules.newsWordCloud = renderExtension('newsWordCloud');
  modules.vocabulary = renderExtension('vocabulary');
  // Installed user modules run their uploaded source in an isolated
  // iframe, gated by the permissions they declared at install time.
  for (const extension of extensionsFeature.extensions) {
    const id = `${SANDBOX_ID_PREFIX}${extension.id}`;
    modules[id] = (
      <SandboxModule
        host={hostFor(id)}
        source={extension.source}
        title={extension.name}
        permissions={extension.permissions}
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

  return (
    <>
      <DesktopShell
        mode={windowMode}
        time={timeFormatter.format(now)}
        dateText={dateFormatter.format(now)}
        summary={summary}
        modules={modules}
        definitions={definitions}
        sandboxExtensions={extensionsFeature.extensions}
        onInstallExtension={extensionsFeature.install}
        onUninstallExtension={extensionsFeature.uninstall}
        isModeSwitching={isSwitchingWindowMode}
        onSetWallpaper={() => void runWindowModeSwitch(switchToWallpaper)}
        onWallpaperDoubleClick={() => void runWindowModeSwitch(switchToForeground)}
        onOpenSettings={() => setModal({type:'settings',trigger:null})}
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
      />
    </>
  );
}

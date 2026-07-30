import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { CalendarWidget } from '../calendar/CalendarWidget';
import { useEvents } from '../calendar/useEvents';
import type { ModalState } from '../lib/modal-store';
import { enterForegroundMode, enterWallpaperMode } from '../lib/window-mode';
import { MatrixWidget } from '../matrix/MatrixWidget';
import { useTasks } from '../matrix/useTasks';
import { ModalRoot } from '../modals/ModalRoot';
import { NotesWidget } from '../notes/NotesWidget';
import { DesktopShell } from './layout/DesktopShell';
import { useAppBootstrap } from './useAppBootstrap';

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
  const bootstrap = useAppBootstrap();
  const retryTasksRef = useRef<() => Promise<unknown>>(async () => undefined);
  const eventsFeature = useEvents({ onRefreshTasks: () => retryTasksRef.current() });
  const tasksFeature = useTasks({ onRefreshEvents: eventsFeature.retryEvents });
  retryTasksRef.current = tasksFeature.retryTasks;
  const events = eventsFeature.events.data;
  const tasks = tasksFeature.tasks.data;
  const notes = bootstrap.notes.data;
  const [modal, setModal] = useState<ModalState>(null);
  const [windowMode, setWindowMode] = useState<WindowMode>('foreground');
  const [isSwitchingWindowMode, setIsSwitchingWindowMode] = useState(false);
  const isSwitchingWindowModeRef = useRef(false);

  const now = new Date();
  const todayIso = localIsoDate(now);
  const todayEventCount = events.filter((event) => event.startAt.startsWith(todayIso)).length;
  const importantTaskCount = tasks.filter(
    (task) => !task.completed && task.quadrant.startsWith('important')
  ).length;
  const summary = `今天 ${todayEventCount} 个日程 · ${importantTaskCount} 个重要任务 · ${notes.length} 条便签`;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<WindowMode>('window-mode-changed', (event) => setWindowMode(event.payload)).then(
      (removeListener) => {
        unlisten = removeListener;
      }
    );
    return () => unlisten?.();
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
        calendar={
          <CalendarWidget
            year={eventsFeature.year}
            monthIndex={eventsFeature.monthIndex}
            todayIso={todayIso}
            events={events}
            status={eventsFeature.events.status}
            errorMessage={eventsFeature.events.status === 'error' ? eventsFeature.events.message : undefined}
            onRetry={() => void eventsFeature.retryEvents()}
            onCreateEvent={() => openModalInForeground({ type: 'event-create', dateIso: todayIso, trigger: null })}
            onPreviousMonth={eventsFeature.goToPreviousMonth}
            onNextMonth={eventsFeature.goToNextMonth}
            onToday={eventsFeature.goToToday}
            onCreateEventForDate={(dateIso) => openModalInForeground({ type: 'event-create', dateIso, trigger: null })}
            onOpenDate={(isoDate) => openModalInForeground({ type: 'date', isoDate, trigger: null })}
            onOpenEvent={(event) => openModalInForeground({ type: 'event-edit', event, trigger: null })}
          />
        }
        matrix={
          <MatrixWidget
            tasks={tasks}
            status={tasksFeature.tasks.status}
            errorMessage={tasksFeature.tasks.status === 'error' ? tasksFeature.tasks.message : undefined}
            onRetry={() => void tasksFeature.retryTasks()}
            onCreateTask={() => undefined}
            onOpenTask={(task) => openModalInForeground({ type: 'task', task })}
          />
        }
        notes={
          <NotesWidget
            notes={notes}
            status={bootstrap.notes.status}
            errorMessage={bootstrap.notes.status === 'error' ? bootstrap.notes.message : undefined}
            onRetry={() => void bootstrap.retryNotes()}
            onCreateNote={() => undefined}
            onOpenNote={(note) => openModalInForeground({ type: 'note', note })}
          />
        }
        isModeSwitching={isSwitchingWindowMode}
        onSetWallpaper={() => void runWindowModeSwitch(switchToWallpaper)}
        onWallpaperDoubleClick={() => void runWindowModeSwitch(switchToForeground)}
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
        onSaved={() => setModal(null)}
        onDeleted={() => setModal(null)}
      />
    </>
  );
}

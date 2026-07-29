import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { CalendarWidget } from '../calendar/CalendarWidget';
import type { ModalState } from '../lib/modal-store';
import { sampleEvents, sampleNotes, sampleTasks } from '../lib/sample-data';
import { enterForegroundMode, enterWallpaperMode } from '../lib/window-mode';
import { MatrixWidget } from '../matrix/MatrixWidget';
import { ModalRoot } from '../modals/ModalRoot';
import { NotesWidget } from '../notes/NotesWidget';
import { DesktopShell } from './layout/DesktopShell';

type WindowMode = 'wallpaper' | 'foreground';

export function App() {
  const [modal, setModal] = useState<ModalState>(null);
  const [windowMode, setWindowMode] = useState<WindowMode>('foreground');
  const [isSwitchingWindowMode, setIsSwitchingWindowMode] = useState(false);
  const isSwitchingWindowModeRef = useRef(false);

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
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="今天 3 个日程 · 2 个重要任务 · 2 条便签"
        calendar={<CalendarWidget year={2026} monthIndex={6} todayIso="2026-07-23" events={sampleEvents} onOpenDate={(isoDate) => openModalInForeground({ type: 'date', isoDate })} onOpenEvent={(event) => openModalInForeground({ type: 'event', event })} />}
        matrix={<MatrixWidget tasks={sampleTasks} onOpenTask={(task) => openModalInForeground({ type: 'task', task })} />}
        notes={<NotesWidget notes={sampleNotes} onOpenNote={(note) => openModalInForeground({ type: 'note', note })} />}
        isModeSwitching={isSwitchingWindowMode}
        onSetWallpaper={() => void runWindowModeSwitch(switchToWallpaper)}
        onWallpaperDoubleClick={() => void runWindowModeSwitch(switchToForeground)}
      />
      <ModalRoot modal={modal} onClose={() => setModal(null)} />
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { AppSettings } from '../data/nowly-repository';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { Note } from '../notes/notes-model';

type Resource<T> =
  | { status: 'loading'; data: T }
  | { status: 'ready'; data: T }
  | { status: 'error'; data: T; message: string };

const defaultSettings: AppSettings = {
  wallpaperEnabled: false,
  launchAtLogin: false,
  targetMonitorId: null,
  density: 'balanced',
  weekStart: 'monday',
  dateFormat: 'localized',
  showWeekends: true,
  calendarEnabled: true,
  matrixEnabled: true,
  notesEnabled: true
};

function messageFrom(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return '无法读取本地数据，请重试。';
}

export function useAppBootstrap() {
  const repository = useNowlyRepository();
  const [notes, setNotes] = useState<Resource<Note[]>>({ status: 'loading', data: [] });
  const [settings, setSettings] = useState<Resource<AppSettings>>({
    status: 'loading',
    data: defaultSettings
  });

  const loadNotes = useCallback(async () => {
    setNotes((current) => ({ status: 'loading', data: current.data }));
    try {
      setNotes({ status: 'ready', data: await repository.listNotes() });
    } catch (error) {
      setNotes((current) => ({ status: 'error', data: current.data, message: messageFrom(error) }));
    }
  }, [repository]);

  const loadSettings = useCallback(async () => {
    setSettings((current) => ({ status: 'loading', data: current.data }));
    try {
      setSettings({ status: 'ready', data: await repository.getSettings() });
    } catch (error) {
      setSettings((current) => ({
        status: 'error',
        data: current.data,
        message: messageFrom(error)
      }));
    }
  }, [repository]);

  useEffect(() => {
    void Promise.allSettled([loadNotes(), loadSettings()]);
  }, [loadNotes, loadSettings]);

  return {
    notes,
    settings,
    retryNotes: loadNotes,
    retrySettings: loadSettings
  };
}

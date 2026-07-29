import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriNowlyRepository } from './tauri-nowly-repository';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

describe('tauriNowlyRepository', () => {
  beforeEach(() => invokeMock.mockReset());

  it('owns the exact startup command names', async () => {
    invokeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ wallpaperEnabled: false });

    await tauriNowlyRepository.listEvents();
    await tauriNowlyRepository.listTasks();
    await tauriNowlyRepository.listNotes();
    await tauriNowlyRepository.getSettings();

    expect(invokeMock.mock.calls).toEqual([
      ['list_events'],
      ['list_tasks'],
      ['list_notes'],
      ['get_app_settings']
    ]);
  });
});

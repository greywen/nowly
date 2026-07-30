import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriNowlyRepository } from './tauri-nowly-repository';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

describe('tauriNowlyRepository', () => {
  beforeEach(() => invokeMock.mockReset());

  it('owns the exact event and startup IPC contracts', async () => {
    invokeMock.mockResolvedValue(undefined);
    const range = {
      startAt: '2026-07-01T00:00',
      endAtExclusive: '2026-08-01T00:00'
    };
    const draft = {
      title: '设计评审',
      startAt: '2026-07-23T14:00',
      endAt: '2026-07-23T15:00',
      allDay: false,
      category: 'work' as const,
      color: 'blue' as const,
      linkedTaskId: null,
      note: ''
    };

    await tauriNowlyRepository.listEventsInRange(range);
    await tauriNowlyRepository.createEvent(draft);
    await tauriNowlyRepository.updateEvent('e1', draft);
    await tauriNowlyRepository.deleteEvent('e1');
    await tauriNowlyRepository.listTasks();
    await tauriNowlyRepository.listNotes();
    await tauriNowlyRepository.getSettings();

    expect(invokeMock.mock.calls).toContainEqual(['list_events_in_range', { range }]);
    expect(invokeMock.mock.calls).toContainEqual(['create_event', { draft }]);
    expect(invokeMock.mock.calls).toContainEqual(['update_event', { id: 'e1', draft }]);
    expect(invokeMock.mock.calls).toContainEqual(['delete_event', { id: 'e1' }]);
    expect(invokeMock.mock.calls).toContainEqual(['list_tasks']);
    expect(invokeMock.mock.calls).toContainEqual(['list_notes']);
    expect(invokeMock.mock.calls).toContainEqual(['get_app_settings']);
  });
});

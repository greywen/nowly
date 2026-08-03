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

    const taskDraft = {
      title: '发布 Nowly',
      quadrant: 'important_urgent' as const,
      dueAt: '2026-07-23',
      priority: 1 as const,
      completed: false,
      linkedEventId: 'e1',
      note: ''
    };

    await tauriNowlyRepository.listEventsInRange(range);
    await tauriNowlyRepository.createEvent(draft);
    await tauriNowlyRepository.updateEvent('e1', draft);
    await tauriNowlyRepository.deleteEvent('e1');
    await tauriNowlyRepository.listTasks();
    await tauriNowlyRepository.createTask(taskDraft);
    await tauriNowlyRepository.updateTask('t1', taskDraft);
    await tauriNowlyRepository.deleteTask('t1');
    await tauriNowlyRepository.setTaskCompleted('t1', true);
    const noteDraft = { title: '产品原则', content: '保持简单', color: 'purple' as const, pinned: true };
    await tauriNowlyRepository.listNotes();
    await tauriNowlyRepository.createNote(noteDraft);
    await tauriNowlyRepository.updateNote('n1', noteDraft);
    await tauriNowlyRepository.deleteNote('n1');
    await tauriNowlyRepository.getSettings();
    await tauriNowlyRepository.updateSettings({
      wallpaperEnabled:false, launchAtLogin:false, targetMonitorId:null,
      density:'balanced', weekStart:'monday', dateFormat:'localized',
      showWeekends:true, calendarEnabled:true, matrixEnabled:true, notesEnabled:true
    });

    expect(invokeMock.mock.calls).toContainEqual(['list_events_in_range', { range }]);
    expect(invokeMock.mock.calls).toContainEqual(['create_event', { draft }]);
    expect(invokeMock.mock.calls).toContainEqual(['update_event', { id: 'e1', draft }]);
    expect(invokeMock.mock.calls).toContainEqual(['delete_event', { id: 'e1' }]);
    expect(invokeMock.mock.calls).toContainEqual(['list_tasks']);
    expect(invokeMock.mock.calls).toContainEqual(['create_task', { draft: taskDraft }]);
    expect(invokeMock.mock.calls).toContainEqual(['update_task', { id: 't1', draft: taskDraft }]);
    expect(invokeMock.mock.calls).toContainEqual(['delete_task', { id: 't1' }]);
    expect(invokeMock.mock.calls).toContainEqual(['set_task_completed', { id: 't1', completed: true }]);
    expect(invokeMock.mock.calls).toContainEqual(['list_notes']);
    expect(invokeMock.mock.calls).toContainEqual(['create_note', { draft: noteDraft }]);
    expect(invokeMock.mock.calls).toContainEqual(['update_note', { id: 'n1', draft: noteDraft }]);
    expect(invokeMock.mock.calls).toContainEqual(['delete_note', { id: 'n1' }]);
    expect(invokeMock.mock.calls).toContainEqual(['get_app_settings']);
    expect(invokeMock.mock.calls).toContainEqual(['update_app_settings', { settings: expect.objectContaining({ density:'balanced' }) }]);
  });
});

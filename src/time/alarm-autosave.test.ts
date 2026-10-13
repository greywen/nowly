import { describe, expect, it, vi } from 'vitest';
import { alarmAutosave } from './alarm-autosave';
import type { Alarm, AlarmDraft, TimeRepository } from './time-model';
const alarm: Alarm = { id: 'a', title: 'Water', hour: 9, minute: 0, enabled: true, repeat: { kind: 'weekly', weekdays: [1] }, createdAt: '', updatedAt: '' };
function repo() { return { updateAlarm: vi.fn(async (id: string, draft: AlarmDraft) => ({ ...alarm, ...draft, id })), deleteAlarm: vi.fn().mockResolvedValue(undefined) } as unknown as TimeRepository; }
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const tick = async () => { await new Promise(r => setTimeout(r, 0)); };

describe('repository alarm queues', () => {
  it('isolates repositories and IDs', async () => {
    const r1 = repo(), r2 = repo(); const s1 = alarmAutosave(r1), s2 = alarmAutosave(r2);
    s1.update(alarm, { title: 'First' }); s1.update({ ...alarm, id: 'b' }, { title: 'Second' }); s2.update(alarm, { minute: 5 });
    await tick();
    expect(s1.get('a')?.draft.title).toBe('First'); expect(s1.get('b')?.draft.title).toBe('Second');
    expect(s2.get('a')?.draft.title).toBe('Water'); expect(s2.get('a')?.draft.minute).toBe(5);
  });
  it('continues with a newer revision after an obsolete write fails', async () => {
    const r = repo(); let reject!: (error: Error) => void;
    vi.mocked(r.updateAlarm).mockImplementationOnce(() => new Promise((_, j) => { reject = j; }));
    const s = alarmAutosave(r); s.update(alarm, { title: 'Old' }); await tick(); s.update(alarm, { title: 'Latest' }); reject(new Error('old failure')); await tick();
    expect(s.get('a')?.status).toBe('saved'); expect(s.get('a')?.draft.title).toBe('Latest'); expect(r.updateAlarm).toHaveBeenCalledTimes(2);
  });
  it('never permits updates after successful deletion', async () => {
    const r = repo(), s = alarmAutosave(r); await s.remove(alarm); s.update(alarm, { title: 'Resurrection' }); s.retry('a'); await tick();
    expect(r.updateAlarm).not.toHaveBeenCalled(); expect(s.get('a')?.status).toBe('deleted');
  });
  it('preserves a successfully persisted write when deletion fails and allows retry', async () => {
    const r = repo(), first = deferred<Alarm>(); vi.mocked(r.updateAlarm).mockImplementationOnce(() => first.promise); vi.mocked(r.deleteAlarm).mockRejectedValueOnce(new Error('delete failed'));
    const s = alarmAutosave(r); s.update(alarm, { title: 'Persisted' }); await tick();
    const changed = vi.fn(); window.addEventListener('nowly:alarms-changed', changed);
    const deletion = s.remove(alarm); first.resolve({ ...alarm, title: 'Persisted' });
    await expect(deletion).rejects.toThrow('delete failed');
    expect(s.get('a')?.persisted.title).toBe('Persisted');
    expect(changed).toHaveBeenCalledOnce();
    await s.remove(alarm); expect(s.get('a')?.status).toBe('deleted');
    window.removeEventListener('nowly:alarms-changed', changed);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { alarmAutosave } from './alarm-autosave';
import type { Alarm, AlarmDraft, TimeRepository } from './time-model';
const alarm: Alarm = { id: 'a', title: 'Water', hour: 9, minute: 0, enabled: true, repeat: { kind: 'weekly', weekdays: [1] }, createdAt: '', updatedAt: '', effectiveFromUtc: '2026-10-11T08:00:00Z' };
function repo() { return { updateAlarm: vi.fn(async (id: string, draft: AlarmDraft) => ({ ...alarm, ...draft, id })), deleteAlarm: vi.fn().mockResolvedValue(undefined) } as unknown as TimeRepository; }
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const tick = async () => { await new Promise(r => setTimeout(r, 0)); };

describe('repository alarm queues', () => {
  it('sends title intent only after scheduler disables a once alarm', async () => {
    const r = repo(), s = alarmAutosave(r);
    const once: Alarm = { ...alarm, repeat: { kind: 'once' } };
    s.seed(once);
    s.update(once, { title: 'After firing' });
    await tick();
    expect(r.updateAlarm).toHaveBeenCalledWith('a', { title: 'After firing' });
  });

  it('reconciles external state while preserving failed title intent and retry', async () => {
    const r = repo(), s = alarmAutosave(r);
    vi.mocked(r.updateAlarm).mockRejectedValueOnce(new Error('offline'));
    s.update(alarm, { title: 'My draft' });
    await tick();
    s.reconcile([{ ...alarm, enabled: false }]);
    expect(s.get('a')?.draft).toMatchObject({ title: 'My draft', enabled: false });
    expect(s.get('a')?.error).toBe('offline');
    s.retry('a');
    await tick();
    expect(r.updateAlarm).toHaveBeenLastCalledWith('a', { title: 'My draft' });
  });

  it('preserves newer queued user intents while reconciling an in-flight write', async () => {
    const r = repo(), s = alarmAutosave(r), first = deferred<Alarm>();
    vi.mocked(r.updateAlarm).mockImplementationOnce(() => first.promise);
    s.update(alarm, { title: 'First' });
    await tick();
    s.update(alarm, { title: 'Latest', enabled: true });
    s.reconcile([{ ...alarm, enabled: false }]);
    expect(s.get('a')?.draft).toMatchObject({ title: 'Latest', enabled: true });
    first.resolve({ ...alarm, title: 'First', enabled: false });
    await tick();
    expect(r.updateAlarm).toHaveBeenLastCalledWith('a', { title: 'Latest', enabled: true });
  });
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

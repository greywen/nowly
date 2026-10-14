import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { AlarmSettingsPanel } from './AlarmSettingsPanel';
import type { Alarm, AlarmDraft } from './time-model';
const alarm: Alarm = { id: 'a', title: 'Water', hour: 9, minute: 0, enabled: true, repeat: { kind: 'weekly', weekdays: [1] }, effectiveFromUtc: '2026-10-14T00:00:00Z', createdAt: '', updatedAt: '' };
function repo() {
  const stored = new Map([[alarm.id, alarm]]);
  return { getTimeSettings: vi.fn(), saveTimeSettings: vi.fn(), listAlarms: vi.fn(async () => [...stored.values()]),
    createAlarm: vi.fn(async (draft: AlarmDraft) => { const saved = { ...alarm, ...draft, id: 'created' }; stored.set(saved.id, saved); return saved; }),
    updateAlarm: vi.fn(async (id: string, patch: Partial<AlarmDraft>) => { const saved = { ...(stored.get(id) ?? alarm), ...patch, id }; stored.set(id, saved); return saved; }),
    deleteAlarm: vi.fn(async (id: string) => { stored.delete(id); }) };
}
function mount(repository: ReturnType<typeof repo>, createAlarm = false) {
  return render(<RepositoryProvider repository={repository as unknown as NowlyRepository}><AlarmSettingsPanel createAlarm={createAlarm} /></RepositoryProvider>);
}
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (v: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }

describe('AlarmSettingsPanel autosave', () => {
  it('reloads a fired once alarm and title edits keep it disabled with its original anchor', async () => {
    const repository = repo();
    let persisted: Alarm = { ...alarm, repeat: { kind: 'once' } };
    repository.listAlarms.mockImplementation(async () => [persisted]);
    repository.updateAlarm.mockImplementation(async (id, patch) => {
      persisted = { ...persisted, ...patch, id };
      return persisted;
    });
    mount(repository);
    fireEvent.click(await screen.findByRole('button', { name: '编辑 Water' }));
    persisted = { ...persisted, enabled: false };
    act(() => window.dispatchEvent(new Event('nowly:alarms-changed')));
    await waitFor(() => expect(screen.getByLabelText('启用')).not.toBeChecked());
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'After firing' } });
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenCalled());
    expect(persisted.enabled).toBe(false);
    expect(persisted.effectiveFromUtc).toBe(alarm.effectiveFromUtc);
    expect(repository.updateAlarm).toHaveBeenLastCalledWith('a', { title: 'After firing' });
  });
  it('reconciles external scheduling changes without replacing a failed title draft', async () => {
    const repository = repo();
    let persisted = alarm;
    repository.listAlarms.mockImplementation(async () => [persisted]);
    repository.updateAlarm.mockRejectedValueOnce(new Error('offline'));
    mount(repository);
    fireEvent.click(await screen.findByRole('button', { name: '编辑 Water' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'My draft' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    persisted = { ...persisted, hour: 10, minute: 17, enabled: false };
    act(() => window.dispatchEvent(new Event('nowly:alarms-changed')));
    await waitFor(() => expect(screen.getByRole('button', { name: '时间' })).toHaveTextContent('10:17'));
    expect(screen.getByLabelText('标题')).toHaveValue('My draft');
    expect(screen.getByLabelText('启用')).not.toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent('offline');
    repository.updateAlarm.mockImplementation(async (id, patch) => ({ ...persisted, ...patch, id }));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenLastCalledWith('a', { title: 'My draft' }));
  });

  it('expands only the corresponding article and restores its edit button focus', async () => {
    const repository = repo();
    repository.listAlarms.mockResolvedValue([alarm, { ...alarm, id: 'b', title: 'Tea' }]);
    mount(repository);
    const first = await screen.findByRole('button', { name: '编辑 Water' });
    const second = screen.getByRole('button', { name: '编辑 Tea' });
    fireEvent.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(within(second.closest('article')!).getByLabelText('标题')).toHaveValue('Tea');
    expect(within(first.closest('article')!).queryByLabelText('标题')).not.toBeInTheDocument();
    fireEvent.click(first);
    expect(screen.getAllByLabelText('标题')).toHaveLength(1);
    expect(second).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: '结束编辑' }));
    expect(first).toHaveFocus();
  });

  it.each([false, true])('closes successful creation and requires explicit editing (direct entry: %s)', async (directEntry) => {
    const repository = repo(); mount(repository, directEntry);
    if (!directEntry) fireEvent.click(screen.getByRole('button', { name: '添加闹钟' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Tea' } });
    expect(repository.createAlarm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '创建闹钟' }));
    const edit = await screen.findByRole('button', { name: '编辑 Tea' });
    expect(edit).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('标题')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '结束编辑' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加闹钟' })).toHaveFocus();
    expect(repository.updateAlarm).not.toHaveBeenCalled();
    fireEvent.click(edit);
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Tea updated' } });
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenCalledWith('created', expect.objectContaining({ title: 'Tea updated' })));
    expect(repository.createAlarm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('标题').closest('article')).toHaveTextContent('Tea updated');
    expect(screen.getAllByLabelText('标题')).toHaveLength(1);
  });

  it('serializes/coalesces edits across close and reopen without stale draft rollback', async () => {
    const repository = repo(); const first = deferred<Alarm>(); repository.updateAlarm.mockImplementationOnce(() => first.promise);
    const view = mount(repository); fireEvent.click(await screen.findByRole('button', { name: '编辑 Water' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'First' } });
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Latest' } });
    view.unmount(); mount(repository);
    fireEvent.click(await screen.findByRole('button', { name: '编辑 Water' }));
    expect(screen.getByLabelText('标题')).toHaveValue('Latest');
    expect(repository.updateAlarm).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve({ ...alarm, title: 'First' }));
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenCalledTimes(2));
    expect(repository.updateAlarm).toHaveBeenLastCalledWith('a', expect.objectContaining({ title: 'Latest' }));
    expect(screen.getByLabelText('标题')).toHaveValue('Latest');
  });

  it('toggles the latest queued draft rather than the stale list row', async () => {
    const repository = repo(); const first = deferred<Alarm>(); repository.updateAlarm.mockImplementationOnce(() => first.promise);
    mount(repository); fireEvent.click(await screen.findByRole('button', { name: '编辑 Water' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Latest' } });
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByLabelText('已启用'));
    await act(async () => first.resolve({ ...alarm, title: 'Latest' }));
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenCalledTimes(2));
    expect(repository.updateAlarm).toHaveBeenLastCalledWith('a', { enabled: false });
    expect(screen.getByLabelText('启用')).not.toBeChecked();
  });

  it('reverses a pending toggle using the optimistic checked state', async () => {
    const repository = repo(); const first = deferred<Alarm>(); repository.updateAlarm.mockImplementationOnce(() => first.promise);
    mount(repository);
    const toggle = await screen.findByRole('checkbox', { name: '已启用' });
    fireEvent.click(toggle);
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenCalledOnce());
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    await act(async () => first.resolve({ ...alarm, enabled: false }));
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenCalledTimes(2));
    expect(repository.updateAlarm).toHaveBeenLastCalledWith('a', expect.objectContaining({ enabled: true }));
  });

  it('retains a failed toggle checked state until a visible retry persists it', async () => {
    const repository = repo(); repository.updateAlarm.mockRejectedValueOnce(new Error('offline'));
    mount(repository);
    const toggle = await screen.findByRole('checkbox', { name: '已启用' });
    fireEvent.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(toggle).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenCalledTimes(2));
    expect(repository.updateAlarm).toHaveBeenLastCalledWith('a', expect.objectContaining({ enabled: false }));
  });

  it('waits for an in-flight write before delete, discards queued updates and emits only persistence events', async () => {
    const repository = repo(); const first = deferred<Alarm>(); repository.updateAlarm.mockImplementationOnce(() => first.promise);
    const changed = vi.fn(); window.addEventListener('nowly:alarms-changed', changed);
    const view = mount(repository); fireEvent.click(await screen.findByRole('button', { name: '编辑 Water' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'First' } });
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Latest' } });
    fireEvent.click(screen.getByRole('button', { name: '删除 Water' }));
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));
    expect(repository.deleteAlarm).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
    await act(async () => first.resolve({ ...alarm, title: 'First' }));
    await waitFor(() => expect(repository.deleteAlarm).toHaveBeenCalledWith('a'));
    expect(repository.updateAlarm).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('button', { name: '编辑 Water' })).not.toBeInTheDocument());
    expect(changed).toHaveBeenCalledOnce();
    view.unmount(); window.removeEventListener('nowly:alarms-changed', changed);
  });

  it('retains failed writes across reopen and retries the draft', async () => {
    const repository = repo(); repository.updateAlarm.mockRejectedValueOnce(new Error('offline'));
    const view = mount(repository); fireEvent.click(await screen.findByRole('button', { name: '编辑 Water' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Latest' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    view.unmount(); mount(repository); fireEvent.click(await screen.findByRole('button', { name: '编辑 Water' }));
    expect(screen.getByLabelText('标题')).toHaveValue('Latest');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenCalledTimes(2));
  });
});

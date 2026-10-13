import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { AlarmSettingsPanel } from './AlarmSettingsPanel';
import type { Alarm, AlarmDraft } from './time-model';
const alarm: Alarm = { id: 'a', title: 'Water', hour: 9, minute: 0, enabled: true, repeat: { kind: 'weekly', weekdays: [1] }, createdAt: '', updatedAt: '' };
function repo() {
  return { getTimeSettings: vi.fn(), saveTimeSettings: vi.fn(), listAlarms: vi.fn().mockResolvedValue([alarm]), createAlarm: vi.fn(async (draft: AlarmDraft) => ({ ...alarm, ...draft, id: 'created' })), updateAlarm: vi.fn(async (id: string, draft: AlarmDraft) => ({ ...alarm, ...draft, id })), deleteAlarm: vi.fn().mockResolvedValue(undefined) };
}
function mount(repository: ReturnType<typeof repo>, createAlarm = false) {
  return render(<RepositoryProvider repository={repository as unknown as NowlyRepository}><AlarmSettingsPanel createAlarm={createAlarm} /></RepositoryProvider>);
}
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (v: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }

describe('AlarmSettingsPanel autosave', () => {
  it('creates once, switches to returned ID and then updates', async () => {
    const repository = repo(); mount(repository, true);
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Tea' } });
    expect(repository.createAlarm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '创建闹钟' }));
    await screen.findByRole('button', { name: '结束编辑' });
    fireEvent.change(screen.getByLabelText('分钟'), { target: { value: '5' } });
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenCalledWith('created', expect.objectContaining({ minute: 5 })));
    expect(repository.createAlarm).toHaveBeenCalledOnce();
  });

  it('serializes/coalesces edits across close and reopen without stale draft rollback', async () => {
    const repository = repo(); const first = deferred<Alarm>(); repository.updateAlarm.mockImplementationOnce(() => first.promise);
    const view = mount(repository); fireEvent.click(await screen.findByRole('button', { name: '编辑 Water' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'First' } });
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Latest' } });
    fireEvent.change(screen.getByLabelText('分钟'), { target: { value: '7' } });
    view.unmount(); mount(repository);
    fireEvent.click(await screen.findByRole('button', { name: '编辑 Water' }));
    expect(screen.getByLabelText('标题')).toHaveValue('Latest');
    expect(repository.updateAlarm).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve({ ...alarm, title: 'First' }));
    await waitFor(() => expect(repository.updateAlarm).toHaveBeenCalledTimes(2));
    expect(repository.updateAlarm).toHaveBeenLastCalledWith('a', expect.objectContaining({ title: 'Latest', minute: 7 }));
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
    expect(repository.updateAlarm).toHaveBeenLastCalledWith('a', expect.objectContaining({ title: 'Latest', enabled: false }));
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

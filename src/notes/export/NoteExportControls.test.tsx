import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NoteExportControls } from './NoteExportControls';
import { exportNotes } from './native';

vi.mock('./native', () => ({ exportNotes: vi.fn() }));
const note = { id:'n1', content:'标题', color:'#4F55DA' as const, pinned:false, styleVariant:0, icon:'' as const, createdAt:'x', updatedAt:'x' };

describe('note export controls', () => {
  it('disables empty selection and submits only the selected snapshot', async () => {
    const user = userEvent.setup();
    vi.mocked(exportNotes).mockResolvedValue(true);
    const { rerender } = render(<NoteExportControls notes={[]} />);
    expect(screen.getByRole('button', { name: '导出所选便签' })).toBeDisabled();
    rerender(<NoteExportControls notes={[note]} />);
    await user.click(screen.getByRole('button', { name: '导出所选便签' }));
    await screen.findByRole('status');
    expect(exportNotes).toHaveBeenCalledWith([note], 'pdf', expect.anything(), expect.any(Function));
    expect(screen.getByRole('status')).toHaveTextContent('已导出');
  });

  it('keeps selection usable after a failure and treats cancellation separately', async () => {
    const user = userEvent.setup();
    vi.mocked(exportNotes).mockRejectedValueOnce(new Error('failure')).mockResolvedValueOnce(false);
    render(<NoteExportControls notes={[note]} />);
    await user.click(screen.getByRole('button', { name: '导出所选便签' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('导出失败');
    await user.click(screen.getByRole('button', { name: '导出所选便签' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('已取消');
  });

  it('blocks duplicate submission until the in-flight export finishes', async () => {
    const user = userEvent.setup();
    let finish!: (saved: boolean) => void;
    vi.mocked(exportNotes).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const busy = vi.fn();
    render(<NoteExportControls notes={[note]} onBusyChange={busy} />);
    await user.click(screen.getByRole('button', { name: '导出所选便签' }));
    expect(screen.getByRole('button', { name: '正在导出…' })).toBeDisabled();
    expect(busy).toHaveBeenCalledWith(true);
    await act(async () => finish(true));
    expect(busy).toHaveBeenLastCalledWith(false);
  });
});

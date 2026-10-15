import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { emptyStickerBoard, newTextSticker, type StickerBoard } from './sticker-model';
import { StickersWidget } from './StickersWidget';
import { setLanguage } from '../i18n';
import * as imageValidation from './sticker-image';
import { LayoutEditingContext } from '../widgets/LayoutEditingContext';

function setup(repository: Partial<NowlyRepository> = {}, readOnly = false) {
  setLanguage('zh');
  const save = vi.fn(async (board: StickerBoard) => ({ ...board, revision: board.revision + 1 }));
  render(<RepositoryProvider repository={{ getStickerBoard: async () => emptyStickerBoard(), saveStickerBoard: save, ...repository } as NowlyRepository}>
    <StickersWidget readOnly={readOnly} />
  </RepositoryProvider>);
  return save;
}
async function addText() {
  const canvas = await screen.findByTestId('sticker-canvas');
  expect(screen.queryByRole('button', { name: '添加文字' })).not.toBeInTheDocument();
  fireEvent.click(canvas, { clientX: 100, clientY: 120 });
  fireEvent.click(screen.getByRole('button', { name: '添加文字' }));
  return screen.getByRole('textbox', { name: '文字内容' });
}
it('adds only at a blank click and edits text and style inline with autosave', async () => {
  const save = setup();
  const input = await addText();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: '专注当下' } });
  fireEvent.click(screen.getByRole('combobox', { name: '字号' }));
  fireEvent.click(screen.getByRole('option', { name: /^48$/ }));
  fireEvent.click(screen.getByRole('combobox', { name: '文字样式' }));
  fireEvent.click(screen.getByRole('option', { name: /^粗体$/ }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ objects: [expect.objectContaining({ x: 100, y: 120, text: '专注当下', fontSize: 48, bold: true })] })));
});
it('resumes autosave when an active IME editor is dismissed without compositionend', async () => {
  const save = setup();
  const input = await addText();
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '输入法草稿' } });
  fireEvent.pointerDown(screen.getByRole('heading', { name: '贴纸' }));
  expect(screen.queryByRole('textbox', { name: '文字内容' })).not.toBeInTheDocument();
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ objects: [expect.objectContaining({ text: '输入法草稿' })] })));
});
it('retains failed drafts, stops automatic retries and retries explicitly', async () => {
  const save = vi.fn().mockRejectedValueOnce({ message: '磁盘已满' }).mockImplementation(async board => ({ ...board, revision: 1 }));
  setup({ saveStickerBoard: save });
  const input = await addText();
  fireEvent.change(input, { target: { value: '保留草稿' } });
  await screen.findByText('磁盘已满');
  fireEvent.change(input, { target: { value: '继续修改' } });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(input).toHaveValue('继续修改');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][0].objects[0].text).toBe('继续修改');
});
it('serializes saves and uses the acknowledged revision without overwriting newer edits', async () => {
  let finish!: (board: StickerBoard) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise<StickerBoard>(resolve => { finish = resolve; }))
    .mockImplementation(async board => ({ ...board, revision: board.revision + 1 }));
  setup({ saveStickerBoard: save });
  const input = await addText();
  fireEvent.change(input, { target: { value: '第一版' } });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: '第二版' } });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ...save.mock.calls[0][0], revision: 7 }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][0]).toMatchObject({ revision: 7, objects: [{ text: '第二版' }] });
  expect(input).toHaveValue('第二版');
});
it('shows conflicts and retains the draft without overwriting storage', async () => {
  const save = vi.fn().mockRejectedValue({ code: 'conflict', message: '版本冲突' });
  setup({ saveStickerBoard: save });
  const input = await addText();
  fireEvent.change(input, { target: { value: '草稿' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('草稿已保留');
  expect(input).toHaveValue('草稿');
});
it('renders a canvas without editing controls in readonly mode', async () => {
  setup({ getStickerBoard: async () => ({ ...emptyStickerBoard(), objects: [newTextSticker('text', '作品')] }) }, true);
  const canvas = await screen.findByTestId('sticker-canvas');
  fireEvent.click(canvas);
  fireEvent.doubleClick(screen.getByText('作品'));
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('shows read failure explicitly and allows retry', async () => {
  const getStickerBoard = vi.fn().mockRejectedValueOnce({ message: '数据库损坏' }).mockResolvedValue(emptyStickerBoard());
  setup({ getStickerBoard });
  expect(await screen.findByRole('alert')).toHaveTextContent('数据库损坏');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByTestId('sticker-canvas')).toBeVisible();
});
it('validates drop and paste images and replaces an image without adding an object', async () => {
  vi.spyOn(imageValidation, 'validateStickerImage').mockResolvedValue({ mime: 'image/png', width: 2, height: 1 });
  const upload = vi.fn().mockResolvedValueOnce({ id: 'a'.repeat(32) }).mockResolvedValueOnce({ id: 'b'.repeat(32) });
  const discard = vi.fn().mockResolvedValue(undefined);
  const save = setup({ uploadStickerImage: upload, discardStickerImages: discard });
  const canvas = await screen.findByTestId('sticker-canvas');
  const file = new File(['png'], 'image.png', { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer });
  fireEvent.drop(canvas, { clientX: 100, clientY: 100, dataTransfer: { files: [file] } });
  await waitFor(() => expect(screen.getAllByTestId('sticker-object')).toHaveLength(1));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '替换图片' }));
  fireEvent.change(screen.getByLabelText('选择图片文件'), { target: { files: [file] } });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(screen.getAllByTestId('sticker-object')).toHaveLength(1);
  await waitFor(() => expect(discard).toHaveBeenCalledWith(['a'.repeat(32)]));
  const oversized = new File(['x'], 'too-large.png', { type: 'image/png' });
  Object.defineProperty(oversized, 'size', { value: 11 * 1024 * 1024 });
  fireEvent.paste(canvas, { clipboardData: { files: [oversized] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('10 MiB');
  expect(upload).toHaveBeenCalledTimes(2);
});
it('suspends autosave while composing and resumes after composition ends', async () => {
  const save = setup();
  const input = await addText();
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '输入法草稿' } });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
  expect(save).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ objects: [expect.objectContaining({ text: '输入法草稿' })] })));
});
it('allows selecting covered and locked objects from layers', async () => {
  setup({ getStickerBoard: async () => ({ ...emptyStickerBoard(), objects: [
    { ...newTextSticker('bottom', '底层'), locked: true }, newTextSticker('top', '顶层')
  ] }) });
  const layers = await screen.findByRole('button', { name: '图层' });
  fireEvent.click(layers);
  fireEvent.click(screen.getByRole('button', { name: '1. 底层 · 已锁定' }));
  fireEvent.click(screen.getByRole('button', { name: '解锁' }));
  fireEvent.click(screen.getByRole('button', { name: /^底层$/ }));
  expect(screen.getByRole('textbox', { name: '文字内容' })).toHaveValue('底层');
});
it('restores an in-flight object gesture when switching into readonly layout mode', async () => {
  const object = newTextSticker('text', 'test');
  const repository = { getStickerBoard: async () => ({ ...emptyStickerBoard(), objects: [object] }), saveStickerBoard: vi.fn(async board => ({ ...board, revision: 1 })) } as unknown as NowlyRepository;
  const view = (editing: boolean) => <RepositoryProvider repository={repository}><LayoutEditingContext.Provider value={editing}><StickersWidget /></LayoutEditingContext.Provider></RepositoryProvider>;
  const { rerender } = render(view(false));
  const item = await screen.findByTestId('sticker-object');
  fireEvent.pointerDown(item, { button: 0, pointerId: 1, clientX: 200, clientY: 200 });
  fireEvent.pointerMove(screen.getByTestId('sticker-canvas'), { pointerId: 1, clientX: 250, clientY: 250 });
  await waitFor(() => expect(item.style.transform).toBe('translate(50px, 50px) rotate(0deg)'));
  rerender(view(true));
  expect(item.style.left).toBe('200px');
  expect(item.style.transform).toBe('rotate(0deg)');
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
});
it('resumes pending text saves when an input composition is interrupted by readonly mode', async () => {
  const save = vi.fn(async (board: StickerBoard) => ({ ...board, revision: board.revision + 1 }));
  const repository = { getStickerBoard: async () => emptyStickerBoard(), saveStickerBoard: save } as unknown as NowlyRepository;
  const view = (readOnly: boolean) => <RepositoryProvider repository={repository}><StickersWidget readOnly={readOnly} /></RepositoryProvider>;
  const { rerender } = render(view(false));
  const input = await addText();
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '保留输入' } });
  rerender(view(true));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ objects: [expect.objectContaining({ text: '保留输入' })] })));
});

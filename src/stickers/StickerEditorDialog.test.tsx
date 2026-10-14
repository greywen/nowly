import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { StickerEditorDialog } from './StickerEditorDialog';
import { emptyStickerBoard, newTextSticker } from './sticker-model';
import * as imageValidation from './sticker-image';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { setLanguage } from '../i18n';

function setup(save = vi.fn().mockResolvedValue({ ...emptyStickerBoard(), revision: 1 })) {
  setLanguage('zh');
  const repository = { saveStickerBoard: save, discardStickerImages: vi.fn().mockResolvedValue(undefined) } as Partial<NowlyRepository>;
  const close = vi.fn();
  const saved = vi.fn();
  render(<RepositoryProvider repository={repository as NowlyRepository}>
    <StickerEditorDialog board={emptyStickerBoard()} onClose={close} onSaved={saved} />
  </RepositoryProvider>);
  return { save, close, saved };
}

it('keeps text changes in a draft until save and submits formatting', async () => {
  const { save, close, saved } = setup();
  fireEvent.click(screen.getByRole('button', { name: '添加文字' }));
  fireEvent.change(screen.getByLabelText('文字内容'), { target: { value: '专注当下' } });
  fireEvent.change(screen.getByLabelText('字号'), { target: { value: '48' } });
  fireEvent.click(screen.getByRole('button', { name: '粗体' }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
    objects: [expect.objectContaining({ text: '专注当下', fontSize: 48, bold: true })]
  })));
  expect(saved).toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
});

it('confirms discard without persisting', async () => {
  const { save, close } = setup();
  fireEvent.click(screen.getByRole('button', { name: '添加文字' }));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.getByText('未保存的内容将丢失。')).toBeVisible();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(save).not.toHaveBeenCalled();
});

it('keeps a failed draft and permits retry', async () => {
  const save = vi.fn().mockRejectedValueOnce({ message: '磁盘已满' }).mockResolvedValue({ ...emptyStickerBoard(), revision: 1 });
  setup(save);
  fireEvent.click(screen.getByRole('button', { name: '添加文字' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('磁盘已满');
  expect(screen.getByLabelText('文字内容')).toHaveValue('文字');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
});

it('shows invalid geometry and prevents saving rather than silently clamping', () => {
  const { save } = setup();
  fireEvent.click(screen.getByRole('button', { name: '添加文字' }));
  fireEvent.change(screen.getByLabelText('横坐标'), { target: { value: '-1' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('完整位于画布内');
});

it('retries cleanup after a successful save without saving the board twice', async () => {
  setLanguage('zh');
  const assetId = 'a'.repeat(32);
  const board = { ...emptyStickerBoard(), objects: [{
    id: 'image', kind: 'image' as const, assetId, style: 'original' as const, locked: false,
    x: 200, y: 200, width: 200, height: 200, rotation: 0, opacity: 100
  }] };
  const save = vi.fn().mockResolvedValue({ ...emptyStickerBoard(), revision: 1 });
  const discard = vi.fn().mockRejectedValueOnce({ message: '文件被占用' }).mockResolvedValue(undefined);
  const close = vi.fn();
  render(<RepositoryProvider repository={{ saveStickerBoard: save, discardStickerImages: discard } as unknown as NowlyRepository}>
    <StickerEditorDialog board={board} onSaved={() => undefined} onClose={close} />
  </RepositoryProvider>);
  fireEvent.click(screen.getByRole('button', { name: '1. 图片' }));
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  const retry = await screen.findByRole('button', { name: '重试清理' });
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(retry);
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(save).toHaveBeenCalledTimes(1);
  expect(discard).toHaveBeenCalledTimes(2);
});

it('cleans up uploaded images when a failed draft is restored to the unchanged board', async () => {
  setLanguage('zh');
  const upload = vi.fn().mockResolvedValue({ id: 'b'.repeat(32), fileName: 'image.png', mime: 'image/png', byteSize: 1, width: 1, height: 1 });
  const discard = vi.fn().mockResolvedValue(undefined);
  const save = vi.fn().mockRejectedValue({ message: '保存失败' });
  const close = vi.fn();
  const validation = vi.spyOn(imageValidation, 'validateStickerImage').mockResolvedValue({ mime: 'image/png', width: 1, height: 1 });
  const originalCreateUrl = URL.createObjectURL;
  const originalRevokeUrl = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn().mockReturnValue('blob:pending');
  URL.revokeObjectURL = vi.fn();
  try {
    const repository: Partial<NowlyRepository> = { uploadStickerImage: upload, saveStickerBoard: save, discardStickerImages: discard };
    render(<RepositoryProvider repository={repository as NowlyRepository}>
      <StickerEditorDialog board={emptyStickerBoard()} onSaved={() => undefined} onClose={close} />
    </RepositoryProvider>);
    const file = new File(['x'], 'image.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer });
    fireEvent.change(screen.getByLabelText('添加图片'), { target: { files: [file] } });
    await screen.findByRole('button', { name: '1. 图片' });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('保存失败');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(discard).toHaveBeenCalledWith(['b'.repeat(32)]);
  } finally {
    validation.mockRestore();
    URL.createObjectURL = originalCreateUrl;
    URL.revokeObjectURL = originalRevokeUrl;
  }
});

it('restores a temporarily invalid image size after deselecting and reselecting it', () => {
  setLanguage('zh');
  const board = { ...emptyStickerBoard(), objects: [{
    id: 'image', kind: 'image' as const, assetId: 'a'.repeat(32), style: 'original' as const, locked: false,
    x: 200, y: 200, width: 200, height: 100, rotation: 0, opacity: 100
  }, newTextSticker('text', '文字')] };
  render(<RepositoryProvider repository={{} as NowlyRepository}>
    <StickerEditorDialog board={board} onSaved={() => undefined} onClose={() => undefined} />
  </RepositoryProvider>);
  fireEvent.click(screen.getByRole('button', { name: '2. 图片' }));
  fireEvent.change(screen.getByLabelText('宽度'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '1. 文字' }));
  fireEvent.click(screen.getByRole('button', { name: '2. 图片' }));
  fireEvent.change(screen.getByLabelText('宽度'), { target: { value: '300' } });
  expect(screen.getByLabelText('高度')).toHaveValue(150);
});

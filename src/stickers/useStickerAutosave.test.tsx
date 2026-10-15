import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { emptyStickerBoard, newTextSticker, type StickerBoard, type ImageSticker } from './sticker-model';
import { useStickerAutosave } from './useStickerAutosave';

const asset = (id: string) => ({ id, fileName: 'image.png', mime: 'image/png', byteSize: 10, width: 1, height: 1 });
const image = (assetId: string): ImageSticker => ({ id: 'image', kind: 'image', assetId, style: 'original', x: 100, y: 100, width: 100, height: 100, rotation: 0, opacity: 100, locked: false });
function setup(repository: Partial<NowlyRepository>, board = emptyStickerBoard()) {
  const repo = { saveStickerBoard: vi.fn(async (draft: StickerBoard) => ({ ...draft, revision: draft.revision + 1 })), ...repository } as NowlyRepository;
  const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={repo}>{children}</RepositoryProvider>;
  return { ...renderHook(() => useStickerAutosave(board), { wrapper }), repo };
}
it('keeps uploaded preview URLs alive until neither draft nor stored board references them', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const actual = 'a'.repeat(32), local = 'b'.repeat(32);
  const { result } = setup({ uploadStickerImage: async () => asset(actual), discardStickerImages: async () => undefined });
  act(() => { result.current.addImage(local, { fileName: 'image.png', bytes: new Uint8Array([1]), url: 'blob:preview' }); result.current.change([image(local)], true); });
  await waitFor(() => expect(result.current.status).toBe('saved'));
  expect(result.current.board.objects[0]).toMatchObject({ assetId: actual });
  expect(result.current.urls[actual]).toBe('blob:preview');
  expect(revoke).not.toHaveBeenCalledWith('blob:preview');
  act(() => result.current.change([], true));
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:preview'));
});
it('retries cleanup without re-saving and does not delete shared or current assets', async () => {
  const old = 'a'.repeat(32), next = 'b'.repeat(32);
  const discard = vi.fn().mockRejectedValueOnce(new Error('locked')).mockResolvedValue(undefined);
  const { result, repo } = setup({ discardStickerImages: discard }, { ...emptyStickerBoard(), objects: [image(old)] });
  act(() => result.current.change([image(next)], true));
  await waitFor(() => expect(result.current.cleanupError).toBe(true));
  expect(discard).toHaveBeenCalledWith([old]);
  await act(async () => result.current.retryCleanup());
  expect(result.current.cleanupError).toBe(false);
  expect(repo.saveStickerBoard).toHaveBeenCalledTimes(1);
  expect(discard).toHaveBeenCalledTimes(2);
});
it('does not upload the same image again when board save fails and retains failed drafts across remount', async () => {
  const upload = vi.fn(async () => asset('a'.repeat(32)));
  const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockImplementation(async draft => ({ ...draft, revision: 1 }));
  const repo = { uploadStickerImage: upload, saveStickerBoard: save, discardStickerImages: vi.fn() } as unknown as NowlyRepository;
  const first = setup(repo);
  act(() => { first.result.current.addImage('b'.repeat(32), { fileName: 'image.png', bytes: new Uint8Array([1]), url: 'blob:retained' }); first.result.current.change([image('b'.repeat(32))], true); });
  await waitFor(() => expect(first.result.current.status).toBe('error'));
  first.unmount();
  const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={first.repo}>{children}</RepositoryProvider>;
  const second = renderHook(() => useStickerAutosave(emptyStickerBoard()), { wrapper });
  expect(second.result.current.board.objects).toHaveLength(1);
  act(() => second.result.current.retry());
  await waitFor(() => expect(second.result.current.status).toBe('saved'));
  expect(upload).toHaveBeenCalledTimes(1);
});
it('does not save gesture intermediate positions and commits only the final draft', async () => {
  const { result, repo } = setup({});
  act(() => { result.current.pause(true); result.current.change([newTextSticker('text', 'draft')]); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
  expect(repo.saveStickerBoard).not.toHaveBeenCalled();
  act(() => { result.current.change([{ ...newTextSticker('text', 'draft'), x: 100 }]); result.current.pause(false); });
  await waitFor(() => expect(repo.saveStickerBoard).toHaveBeenCalledWith(expect.objectContaining({ objects: [expect.objectContaining({ x: 100 })] })));
});

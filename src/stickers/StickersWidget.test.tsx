import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { emptyStickerBoard } from './sticker-model';
import { StickersWidget } from './StickersWidget';
import { setLanguage } from '../i18n';

it('offers empty state only after a successful read', async () => {
  setLanguage('zh');
  const edit = vi.fn();
  const repository = { getStickerBoard: vi.fn().mockResolvedValue(emptyStickerBoard()) };
  render(<RepositoryProvider repository={repository as unknown as NowlyRepository}>
    <StickersWidget onEdit={edit} onClose={() => undefined} editing={false} />
  </RepositoryProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '添加文字' }));
  expect(edit).toHaveBeenCalled();
});

it('shows read failure explicitly and allows retry', async () => {
  setLanguage('zh');
  const getStickerBoard = vi.fn().mockRejectedValueOnce({ message: '数据库损坏' }).mockResolvedValue(emptyStickerBoard());
  render(<RepositoryProvider repository={{ getStickerBoard } as unknown as NowlyRepository}>
    <StickersWidget onEdit={() => undefined} onClose={() => undefined} editing={false} />
  </RepositoryProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('数据库损坏');
  expect(screen.queryByText('放一张喜欢的图片，或写一句给自己的话。')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('放一张喜欢的图片，或写一句给自己的话。')).toBeVisible();
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock
}));

describe('App window behavior', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => undefined);
    invokeMock.mockResolvedValue('ok');
  });

  it('starts in foreground without automatically entering wallpaper mode', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: '设为壁纸' })).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('enters wallpaper from the content action and returns on wallpaper double click', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '设为壁纸' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('enter_wallpaper_mode'));
    await waitFor(() => expect(screen.queryByRole('button', { name: '设为壁纸' })).not.toBeInTheDocument());

    fireEvent.doubleClick(screen.getByTestId('desktop-root'));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('enter_foreground_mode'));
    await waitFor(() => expect(screen.getByRole('button', { name: '设为壁纸' })).toBeInTheDocument());
  });

  it('updates the wallpaper action when the tray changes window mode', async () => {
    let modeListener: ((event: { payload: 'foreground' | 'wallpaper' }) => void) | undefined;
    listenMock.mockImplementation((_eventName, listener) => {
      modeListener = listener;
      return Promise.resolve(() => undefined);
    });
    render(<App />);
    await waitFor(() => expect(modeListener).toBeDefined());

    modeListener?.({ payload: 'wallpaper' });
    await waitFor(() => expect(screen.queryByRole('button', { name: '设为壁纸' })).not.toBeInTheDocument());
    modeListener?.({ payload: 'foreground' });
    await waitFor(() => expect(screen.getByRole('button', { name: '设为壁纸' })).toBeInTheDocument());
  });
});

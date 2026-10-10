import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { CAPTURE_BEGIN_EVENT, useCaptureFrame } from './useCaptureFrame';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string, protocol?: string) => `${protocol}://localhost/${path}`)
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn()
}));

const PLAN = {
  path: '7/1',
  width: 1920,
  height: 1080,
  originX: -1920,
  originY: 0,
  windowCandidates: [{ x: 20, y: 30, width: 640, height: 480 }]
};

/// The begin-event handler the hook registered, and a spy for its removal.
let begin: (() => void) | undefined;
const unlisten = vi.fn();

describe('useCaptureFrame', () => {
  beforeEach(() => {
    begin = undefined;
    unlisten.mockReset();
    vi.mocked(listen).mockReset();
    vi.mocked(listen).mockImplementation((event, handler) => {
      expect(event).toBe(CAPTURE_BEGIN_EVENT);
      begin = handler as unknown as () => void;
      return Promise.resolve(unlisten);
    });
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'describe_capture_frame') return Promise.resolve(PLAN);
      return Promise.resolve(undefined);
    });
    vi.mocked(convertFileSrc).mockClear();
  });

  function decodedImage(width = 1920, height = 1080) {
    return {
      naturalWidth: width,
      naturalHeight: height,
      decode: vi.fn().mockResolvedValue(undefined)
    } as unknown as HTMLImageElement;
  }

  it('is ready and acknowledges as soon as the plan arrives, before any pixels load', async () => {
    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(convertFileSrc).toHaveBeenCalledWith('7/1', 'nowly-frame');
    expect(result.current).toEqual({
      status: 'ready',
      frame: {
        src: 'nowly-frame://localhost/7/1',
        width: 1920,
        height: 1080,
        originX: -1920,
        originY: 0,
        windowCandidates: [{ x: 20, y: 30, width: 640, height: 480 }]
      },
      pixels: 'loading',
      onFrameLoad: expect.any(Function),
      onFrameError: expect.any(Function)
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('capture_window_ready'));
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('registers for the begin event before asking for its frame', async () => {
    const order: string[] = [];
    vi.mocked(listen).mockImplementation((_event, handler) => {
      order.push('listen');
      begin = handler as unknown as () => void;
      return Promise.resolve(unlisten);
    });
    vi.mocked(invoke).mockImplementation((command: string) => {
      order.push(command);
      return Promise.resolve(command === 'describe_capture_frame' ? PLAN : undefined);
    });
    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(order.slice(0, 2)).toEqual(['listen', 'describe_capture_frame']);
  });

  it('waits for the begin event when prewarmed before its session', async () => {
    let frames: typeof PLAN | null = null;
    vi.mocked(invoke).mockImplementation((command: string) =>
      Promise.resolve(command === 'describe_capture_frame' ? frames : undefined)
    );
    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('describe_capture_frame'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe('loading');
    expect(invoke).not.toHaveBeenCalledWith('capture_window_ready');
    expect(invoke).not.toHaveBeenCalledWith('capture_window_failed');

    frames = PLAN;
    act(() => begin?.());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('capture_window_ready'));
  });

  it('asks again when the begin event races a pending answer', async () => {
    const answers: Array<(plan: typeof PLAN | null) => void> = [];
    vi.mocked(invoke).mockImplementation((command: string) =>
      command === 'describe_capture_frame'
        ? new Promise((resolve) => answers.push(resolve))
        : Promise.resolve(undefined)
    );
    const { result } = renderHook(() => useCaptureFrame());
    await waitFor(() => expect(answers).toHaveLength(1));

    // The event lands while the first, frameless request is still in flight.
    act(() => begin?.());
    expect(answers).toHaveLength(1);
    await act(async () => answers[0](null));

    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => answers[1](PLAN));
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('keeps the captured physical pixel size', async () => {
    // The overlay window covers physical pixels; a scaled display must not shrink
    // the reported frame size.
    vi.mocked(invoke).mockResolvedValue({
      path: '1/0',
      width: 2240,
      height: 1400,
      originX: 0,
      originY: 0,
      windowCandidates: []
    });

    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ frame: { width: 2240, height: 1400 } });
  });

  it('marks pixels ready only after the loaded image decodes at the planned size', async () => {
    const image = decodedImage();
    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.onFrameLoad(image);
    });

    expect(image.decode).toHaveBeenCalledOnce();
    expect(result.current.pixels).toBe('ready');
  });

  it('treats a pixel load failure as an unavailable readout, not a failed session', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => {
      result.current.onFrameError();
      result.current.onFrameError();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.pixels).toBe('unavailable');
    expect(invoke).not.toHaveBeenCalledWith('capture_window_failed');
    logged.mockRestore();
  });

  it('reports a decode failure as unavailable pixels', async () => {
    const image = decodedImage();
    vi.mocked(image.decode).mockRejectedValue(new Error('decode failed'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.onFrameLoad(image);
    });

    expect(result.current.pixels).toBe('unavailable');
    expect(invoke).not.toHaveBeenCalledWith('capture_window_failed');
    logged.mockRestore();
  });

  it('rejects pixels whose natural dimensions do not match the plan', async () => {
    const image = decodedImage(1919, 1080);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.onFrameLoad(image);
    });

    expect(image.decode).not.toHaveBeenCalled();
    expect(result.current.pixels).toBe('unavailable');
    logged.mockRestore();
  });

  it('reports a describe failure to the native startup barrier', async () => {
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'describe_capture_frame') {
        return Promise.reject(new Error('截图会话已结束。'));
      }
      return Promise.resolve(undefined);
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(invoke).toHaveBeenCalledWith('capture_window_failed');
    expect(invoke).not.toHaveBeenCalledWith('capture_window_ready');
    logged.mockRestore();
  });

  it('still asks for its frame when the begin listener cannot register', async () => {
    vi.mocked(listen).mockRejectedValue(new Error('no event bridge'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    logged.mockRestore();
  });

  it('ignores a late answer after the overlay is gone and stops listening', async () => {
    let settle: ((plan: unknown) => void) | undefined;
    vi.mocked(invoke).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      })
    );
    const { result, unmount } = renderHook(() => useCaptureFrame());
    await waitFor(() => expect(settle).toBeDefined());

    unmount();
    settle?.(PLAN);
    await act(async () => {
      await Promise.resolve();
    });

    // Still loading: a resolved request must not set state on a torn-down overlay.
    expect(result.current.status).toBe('loading');
    expect(unlisten).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith('capture_window_ready');
  });

  it('ignores a late decode after the overlay is gone', async () => {
    let finishDecode: (() => void) | undefined;
    const image = decodedImage();
    vi.mocked(image.decode).mockReturnValue(
      new Promise<void>((resolve) => {
        finishDecode = resolve;
      })
    );
    const { result, unmount } = renderHook(() => useCaptureFrame());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let loading: Promise<void> | undefined;
    act(() => {
      loading = result.current.onFrameLoad(image);
    });
    unmount();
    finishDecode?.();
    await act(async () => {
      await loading;
    });

    expect(result.current.pixels).toBe('loading');
  });

  it('coalesces duplicate load events while decoding', async () => {
    let finishDecode: (() => void) | undefined;
    const image = decodedImage();
    vi.mocked(image.decode).mockReturnValue(
      new Promise<void>((resolve) => {
        finishDecode = resolve;
      })
    );
    const { result } = renderHook(() => useCaptureFrame());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let first: Promise<void> | undefined;
    act(() => {
      first = result.current.onFrameLoad(image);
      void result.current.onFrameLoad(image);
    });
    finishDecode?.();
    await act(async () => {
      await first;
    });

    expect(image.decode).toHaveBeenCalledOnce();
    expect(result.current.pixels).toBe('ready');
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useCaptureFrame } from './useCaptureFrame';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string, protocol?: string) => `${protocol}://localhost/${path}`)
}));

describe('useCaptureFrame', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'describe_capture_frame') {
        return Promise.resolve({
          path: '7/1',
          width: 1920,
          height: 1080,
          originX: -1920,
          originY: 0,
          windowCandidates: [{ x: 20, y: 30, width: 640, height: 480 }]
        });
      }
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

  it('builds the frame source without reporting ready before pixels load', async () => {
    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(result.current.status).toBe('decoding'));
    expect(convertFileSrc).toHaveBeenCalledWith('7/1', 'nowly-frame');
    expect(result.current).toEqual({
      status: 'decoding',
      frame: {
        src: 'nowly-frame://localhost/7/1',
        width: 1920,
        height: 1080,
        originX: -1920,
        originY: 0,
        windowCandidates: [{ x: 20, y: 30, width: 640, height: 480 }]
      },
      onFrameLoad: expect.any(Function),
      onFrameError: expect.any(Function)
    });
    expect(invoke).not.toHaveBeenCalledWith('capture_window_ready');
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

    await waitFor(() => expect(result.current.status).toBe('decoding'));
    expect(result.current).toMatchObject({ frame: { width: 2240, height: 1400 } });
  });

  it('reports ready only after the loaded image finishes decoding at the planned size', async () => {
    const image = decodedImage();
    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(result.current.status).toBe('decoding'));
    await act(async () => {
      await result.current.onFrameLoad(image);
    });

    expect(image.decode).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith('capture_window_ready');
    expect(result.current.status).toBe('ready');
  });

  it('reports an image load failure to the capture session exactly once', async () => {
    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(result.current.status).toBe('decoding'));
    act(() => {
      result.current.onFrameError();
      result.current.onFrameError();
    });

    expect(result.current.status).toBe('failed');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith('capture_window_failed');
    expect(invoke).not.toHaveBeenCalledWith('capture_window_ready');
  });

  it('reports a decode failure without reporting ready', async () => {
    const image = decodedImage();
    vi.mocked(image.decode).mockRejectedValue(new Error('decode failed'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(result.current.status).toBe('decoding'));
    await act(async () => {
      await result.current.onFrameLoad(image);
    });

    expect(result.current.status).toBe('failed');
    expect(invoke).toHaveBeenCalledWith('capture_window_failed');
    expect(invoke).not.toHaveBeenCalledWith('capture_window_ready');
    logged.mockRestore();
  });

  it('rejects decoded pixels whose natural dimensions do not match the plan', async () => {
    const image = decodedImage(1919, 1080);
    const { result } = renderHook(() => useCaptureFrame());

    await waitFor(() => expect(result.current.status).toBe('decoding'));
    await act(async () => {
      await result.current.onFrameLoad(image);
    });

    expect(result.current.status).toBe('failed');
    expect(invoke).toHaveBeenCalledWith('capture_window_failed');
    expect(invoke).not.toHaveBeenCalledWith('capture_window_ready');
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
    logged.mockRestore();
  });

  it('ignores a late answer after the overlay is gone', async () => {
    let settle: ((plan: unknown) => void) | undefined;
    vi.mocked(invoke).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      })
    );
    const { result, unmount } = renderHook(() => useCaptureFrame());

    unmount();
    settle?.({ path: '1/0', width: 8, height: 8 });

    // Still loading: a resolved request must not set state on a torn-down overlay.
    expect(result.current.status).toBe('loading');
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
    await waitFor(() => expect(result.current.status).toBe('decoding'));

    let loading: Promise<void> | undefined;
    act(() => {
      loading = result.current.onFrameLoad(image);
    });
    unmount();
    finishDecode?.();
    await act(async () => {
      await loading;
    });

    expect(invoke).not.toHaveBeenCalledWith('capture_window_ready');
    expect(invoke).not.toHaveBeenCalledWith('capture_window_failed');
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
    await waitFor(() => expect(result.current.status).toBe('decoding'));

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
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith('capture_window_ready');
  });
});

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from './annotation-document';
import { useMosaicPreview } from './useMosaicPreview';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `nowly-frame://${path}`)
}));

const selection = { x: 20, y: 30, width: 100, height: 80 };
const mosaic: Annotation = {
  id: 'mask', kind: 'mosaic', x: 25, y: 37, width: 30, height: 20,
  blockSize: 8, color: '#211f1c',
  // The painted cells are the object; the box is only their bounds.
  blocks: [{ x: 25, y: 37, width: 30, height: 20 }]
};

describe('useMosaicPreview', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue({ path: 'preview/7/1', width: 100, height: 80 });
    vi.mocked(convertFileSrc).mockClear();
  });

  it('uses signed desktop coordinates without translating local mosaic regions', async () => {
    const { result } = renderHook(() =>
      useMosaicPreview([mosaic], selection, 1, { x: -1920, y: -200 })
    );
    await waitFor(() => expect(result.current.url).toBe('nowly-frame://preview/7/1'));
    expect(invoke).toHaveBeenCalledWith('render_mosaic_preview', {
      geometry: {
        x: -1900, y: -170, width: 100, height: 80,
        mosaics: [{ x: 5, y: 7, width: 30, height: 20, blockSize: 8 }],
        version: 1, hasOverlay: false
      }
    });
  });

  it('does not resurrect a preview after the last mosaic was removed', async () => {
    let finish!: (plan: { path: string }) => void;
    vi.mocked(invoke).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(
      ({ objects }: { objects: Annotation[] }) => useMosaicPreview(objects, selection, 1),
      { initialProps: { objects: [mosaic] } }
    );
    rerender({ objects: [] });
    await act(async () => { finish({ path: 'preview/7/stale' }); });
    expect(result.current.url).toBeNull();
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  it('does not publish an unmounted request', async () => {
    let finish!: (plan: { path: string }) => void;
    vi.mocked(invoke).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { unmount } = renderHook(() => useMosaicPreview([mosaic], selection, 1));
    unmount();
    await act(async () => { finish({ path: 'preview/7/stale' }); });
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  it('hides the old preview while changed geometry is being rendered', async () => {
    const { result, rerender } = renderHook(
      ({ objects }: { objects: Annotation[] }) => useMosaicPreview(objects, selection, 1),
      { initialProps: { objects: [mosaic] } }
    );
    await waitFor(() => expect(result.current.url).not.toBeNull());
    let finish!: (plan: { path: string }) => void;
    vi.mocked(invoke).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    rerender({ objects: [{ ...mosaic, blocks: [{ x: 25, y: 37, width: 60, height: 20 }] }] });
    expect(result.current.url).toBeNull();
    await act(async () => { finish({ path: 'preview/7/new' }); });
    expect(result.current.url).toBe('nowly-frame://preview/7/new');
  });

  it('invalidates cached pixels when the display origin changes', async () => {
    const { result, rerender } = renderHook(
      ({ x }) => useMosaicPreview([mosaic], selection, 1, { x, y: 0 }),
      { initialProps: { x: 0 } }
    );
    await waitFor(() => expect(result.current.url).not.toBeNull());
    rerender({ x: -1920 });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenLastCalledWith(
      'render_mosaic_preview', { geometry: expect.objectContaining({ x: -1900 }) }
    );
  });
});

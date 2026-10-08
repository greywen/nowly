import { invoke } from '@tauri-apps/api/core';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAnnotation, emptyDocument, type Annotation } from './annotation-document';
import { rasterizeAnnotations } from './rasterize';
import { useExport } from './useExport';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./rasterize', () => ({ rasterizeAnnotations: vi.fn() }));

const selection = { x: 20, y: 30, width: 100, height: 80 };
const mosaic: Annotation = {
  id: 'mask', kind: 'mosaic', x: 25, y: 37, width: 30, height: 20,
  blockSize: 8, color: '#211f1c',
  // The painted cells are the object; the box is only their bounds.
  blocks: [{ x: 25, y: 37, width: 30, height: 20 }]
};

describe('useExport', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
    vi.mocked(rasterizeAnnotations).mockReset();
  });

  it('uses virtual-desktop coordinates but keeps mosaics selection-local', async () => {
    const doc = addAnnotation(emptyDocument(), mosaic);
    const { result } = renderHook(() =>
      useExport(doc, selection, () => null, { x: -1920, y: -200 })
    );
    await act(async () => { await result.current.copy(); });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('copy_capture_to_clipboard', {
      geometry: {
        x: -1900, y: -170, width: 100, height: 80,
        mosaics: [{ x: 5, y: 7, width: 30, height: 20, blockSize: 8 }],
        version: 1, hasOverlay: false
      }
    });
    expect(doc.objects).toEqual([mosaic]);
  });

  it('allows only one copy or save before React has rerendered', async () => {
    let finish!: () => void;
    vi.mocked(invoke).mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useExport(emptyDocument(), selection, () => null));
    let copy!: Promise<void>;
    let save!: Promise<void>;
    act(() => {
      copy = result.current.copy();
      save = result.current.save();
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('copying');
    await act(async () => {
      finish();
      await Promise.all([copy, save]);
    });
  });

  it('holds the shared latch while rasterizing the annotation overlay', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const doc = addAnnotation(emptyDocument(), {
      id: 'box', kind: 'rect', ...selection, color: '#211f1c', strokeWidth: 2
    });
    let finish!: (pixels: Uint8Array) => void;
    vi.mocked(rasterizeAnnotations).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useExport(doc, selection, () => svg));
    let copy!: Promise<void>;
    act(() => { copy = result.current.copy(); });
    await act(async () => { await result.current.save(); });
    expect(rasterizeAnnotations).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => {
      finish(new Uint8Array(selection.width * selection.height * 4));
      await copy;
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith('copy_capture_to_clipboard', expect.any(Object));
  });

  it('keeps a failed export retryable and preserves the document', async () => {
    const doc = addAnnotation(emptyDocument(), mosaic);
    vi.mocked(invoke).mockRejectedValueOnce({ message: 'Clipboard unavailable' });
    const { result } = renderHook(() => useExport(doc, selection, () => null));
    await act(async () => { await result.current.copy(); });
    expect(result.current.state).toEqual({
      status: 'failed', message: 'Clipboard unavailable', fallbackKey: null
    });
    await act(async () => { await result.current.copy(); });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.current.state.status).toBe('idle');
    expect(doc.objects).toEqual([mosaic]);
  });

  it('returns to editing after a cancelled save without discarding annotations', async () => {
    const doc = addAnnotation(emptyDocument(), mosaic);
    vi.mocked(invoke).mockResolvedValue(false);
    const { result } = renderHook(() => useExport(doc, selection, () => null));
    await act(async () => { await result.current.save(); });
    expect(result.current.state.status).toBe('idle');
    expect(invoke).not.toHaveBeenCalledWith('cancel_screen_capture');
    expect(doc.objects).toEqual([mosaic]);
    await act(async () => { await result.current.copy(); });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('does not output without a committed selection', async () => {
    const { result } = renderHook(() => useExport(emptyDocument(), null, () => null));
    await act(async () => {
      await result.current.copy();
      await result.current.save();
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});

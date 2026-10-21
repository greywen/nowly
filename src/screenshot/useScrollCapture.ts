import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { acceptScrollUpdate, type ScrollState } from './scroll-model';

type Region = { x: number; y: number; width: number; height: number };

/// The scrolling capture driven from the overlay itself. The preview is a
/// downscaled PNG of the confirmed image, refetched whenever it grows.
export function useScrollCapture(previewWidth: number) {
  const [state, setState] = useState<ScrollState | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const starting = useRef(false);
  const pendingPreview = useRef<{ revision: number; sessionId: string; width: number } | null>(null);
  const fetchingPreview = useRef(false);
  const mounted = useRef(true);
  const previewUrl = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingPreview.current = null;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    void listen<ScrollState>('screenshot-scroll-state', (event) => {
      if (active) setState((current) => acceptScrollUpdate(current, event.payload));
    }).then((unlisten) => {
      if (active) stop = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      stop?.();
    };
  }, []);

  const revision = state && state.height > 0 ? state.revision : null;
  const sessionId = state?.sessionId;
  useEffect(() => {
    if (revision === null || !sessionId) return;
    pendingPreview.current = { revision, sessionId, width: previewWidth };
    if (fetchingPreview.current) return;
    fetchingPreview.current = true;
    void (async () => {
      try {
        while (mounted.current && pendingPreview.current) {
          const request = pendingPreview.current;
          pendingPreview.current = null;
          const scale = Math.max(1, Math.round(window.devicePixelRatio || 1));
          try {
            const bytes = await invoke<ArrayBuffer>('scroll_capture_image', {
              revision: request.revision, maxWidth: request.width * scale
            });
            if (!mounted.current) break;
            const next = pendingPreview.current as typeof request | null;
            if (next && next.sessionId !== request.sessionId) continue;
            const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
            const old = previewUrl.current;
            previewUrl.current = url;
            setPreview(url);
            if (old) URL.revokeObjectURL(old);
          } catch {
            // Keep the last completed preview; a queued revision is tried next.
          }
        }
      } finally {
        fetchingPreview.current = false;
      }
    })();
  }, [revision, sessionId, previewWidth]);

  const start = useCallback(async (region: Region) => {
    if (starting.current) return;
    starting.current = true;
    try {
      const result = await invoke<ScrollState>('scroll_capture', { action: 'start', region });
      setState((current) => acceptScrollUpdate(current, result));
    } finally {
      starting.current = false;
    }
  }, []);

  /// Freezes the confirmed image as the screenshot's output.
  const finish = useCallback(async () => {
    const result = await invoke<ScrollState>('scroll_capture', { action: 'finish' });
    setState((current) => acceptScrollUpdate(current, result));
    return result;
  }, []);

  return { state, preview, start, finish };
}

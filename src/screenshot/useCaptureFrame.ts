import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// The frozen frame this overlay covers.
//
// The desktop the user sees is painted by a native window directly beneath this
// transparent overlay, so the overlay is usable as soon as it knows its frame's
// geometry. The pixels themselves still arrive over the `nowly-frame` local scheme
// for the magnifier and colour readout, decoded by the WebView off the startup
// path, never through a large Base64 invoke (§9). The URL carries the session id,
// so a frame belonging to a finished session is refused by Rust.
//
// Overlays may be built before their session begins. `describe_capture_frame`
// answers `null` until this window's frames exist, and the begin event says when
// to ask again.

const FRAME_SCHEME = 'nowly-frame';
export const CAPTURE_BEGIN_EVENT = 'screenshot-capture-begin';

export type CaptureFrame = {
  /// Ready-to-use source for the frame image.
  src: string;
  /// Physical pixels of the captured display.
  width: number;
  height: number;
  /// Signed physical origin on the Windows virtual desktop.
  originX: number;
  originY: number;
  /// Display-local, clipped physical rectangles in topmost-first order.
  windowCandidates: readonly CaptureWindowCandidate[];
};

export type CaptureWindowCandidate = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type FramePlan = {
  path: string;
  width: number;
  height: number;
  originX: number;
  originY: number;
  windowCandidates: CaptureWindowCandidate[];
};

export type CaptureFrameState =
  | { status: 'loading' }
  | { status: 'ready'; frame: CaptureFrame }
  | { status: 'failed' };

/// Whether the frame's pixels can be sampled. `unavailable` is an explicit
/// invalid state for the readout (§4.3), not a session failure: the frozen
/// desktop is already on screen and exports read Rust's own copy.
export type FramePixels = 'loading' | 'ready' | 'unavailable';

export type CaptureFrameResult = CaptureFrameState & {
  pixels: FramePixels;
  onFrameLoad: (image: HTMLImageElement) => Promise<void>;
  onFrameError: () => void;
};

type FrameOutcome = 'pending' | 'ready' | 'failed';

export function useCaptureFrame(): CaptureFrameResult {
  const [state, setState] = useState<CaptureFrameState>({ status: 'loading' });
  const [pixels, setPixels] = useState<FramePixels>('loading');
  const activeRef = useRef(false);
  const generationRef = useRef(0);
  const frameRef = useRef<CaptureFrame | null>(null);
  const outcomeRef = useRef<FrameOutcome>('pending');
  const pixelsRef = useRef<FramePixels | 'decoding'>('loading');

  const reportFailure = useCallback(() => {
    if (!activeRef.current || outcomeRef.current !== 'pending') return;
    outcomeRef.current = 'failed';
    setState({ status: 'failed' });
    void invoke('capture_window_failed').catch((error: unknown) => {
      // Rust may already have torn down a stale window. The native command is
      // idempotent, so only a genuine IPC rejection is worth logging.
      console.error('failed to report the capture window failure', error);
    });
  }, []);

  useEffect(() => {
    let active = true;
    activeRef.current = true;
    outcomeRef.current = 'pending';
    pixelsRef.current = 'loading';
    frameRef.current = null;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const current = () => active && generationRef.current === generation;

    let requesting = false;
    let askAgain = false;
    const describe = () => {
      if (!current() || frameRef.current) return;
      if (requesting) {
        // The begin event raced an earlier `null`; ask once more afterwards.
        askAgain = true;
        return;
      }
      requesting = true;
      invoke<FramePlan | null>('describe_capture_frame')
        .then((plan) => {
          requesting = false;
          if (!current()) return;
          if (!plan) {
            if (askAgain) {
              askAgain = false;
              describe();
            }
            return;
          }
          const frame = {
            // convertFileSrc picks the right form per platform: a custom scheme
            // on macOS/Linux, `http://<scheme>.localhost/...` on Windows.
            src: convertFileSrc(plan.path, FRAME_SCHEME),
            width: plan.width,
            height: plan.height,
            originX: plan.originX ?? 0,
            originY: plan.originY ?? 0,
            windowCandidates: (plan.windowCandidates ?? []).filter(
              (candidate) =>
                candidate.width > 0 &&
                candidate.height > 0 &&
                candidate.x >= 0 &&
                candidate.y >= 0 &&
                candidate.x + candidate.width <= plan.width &&
                candidate.y + candidate.height <= plan.height
            )
          };
          frameRef.current = frame;
          setState({ status: 'ready', frame });
        })
        .catch((error: unknown) => {
          requesting = false;
          if (!current()) return;
          // Reported in place as static text, per design.md §11's Error state.
          // The session stays cancellable with Esc.
          console.error('failed to describe the capture frame', error);
          reportFailure();
        });
    };

    // Listen first, then ask: a begin event can then never fall between a
    // `null` answer and the listener being registered.
    let unlisten: (() => void) | undefined;
    listen(CAPTURE_BEGIN_EVENT, describe)
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch((error: unknown) => {
        console.error('failed to listen for the capture start', error);
      })
      .finally(describe);

    return () => {
      active = false;
      activeRef.current = false;
      generationRef.current += 1;
      unlisten?.();
    };
  }, [reportFailure]);

  // Acknowledged after React commits the ready surface, so the dim and the
  // selection layer exist before Rust shows the window.
  useEffect(() => {
    if (state.status !== 'ready' || outcomeRef.current !== 'pending') return;
    outcomeRef.current = 'ready';
    const generation = generationRef.current;
    void invoke('capture_window_ready').catch((error: unknown) => {
      if (!activeRef.current || generationRef.current !== generation) return;
      console.error('failed to report the capture window readiness', error);
      outcomeRef.current = 'failed';
      setState({ status: 'failed' });
      void invoke('capture_window_failed').catch((reportError: unknown) => {
        console.error('failed to report the capture window failure', reportError);
      });
    });
  }, [state.status]);

  const markUnavailable = useCallback((reason: string, error?: unknown) => {
    pixelsRef.current = 'unavailable';
    setPixels('unavailable');
    console.error(reason, error);
  }, []);

  const onFrameLoad = useCallback(
    async (image: HTMLImageElement) => {
      const generation = generationRef.current;
      const frame = frameRef.current;
      if (!activeRef.current || !frame || pixelsRef.current !== 'loading') return;

      // `load` proves the response completed; decode makes sampling cheap and
      // proves the pixels are usable before the magnifier draws from them.
      pixelsRef.current = 'decoding';
      if (image.naturalWidth !== frame.width || image.naturalHeight !== frame.height) {
        markUnavailable('the capture frame does not match its planned size');
        return;
      }
      try {
        if (typeof image.decode === 'function') await image.decode();
      } catch (error: unknown) {
        if (!activeRef.current || generationRef.current !== generation) return;
        markUnavailable('failed to decode the capture frame', error);
        return;
      }
      if (!activeRef.current || generationRef.current !== generation) return;
      pixelsRef.current = 'ready';
      setPixels('ready');
    },
    [markUnavailable]
  );

  const onFrameError = useCallback(() => {
    if (!activeRef.current || pixelsRef.current === 'ready') return;
    markUnavailable('failed to load the capture frame');
  }, [markUnavailable]);

  return { ...state, pixels, onFrameLoad, onFrameError };
}

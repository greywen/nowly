import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';

// The frozen frame this overlay shows.
//
// Pixels arrive over the `nowly-frame` local scheme as a PNG the WebView decodes
// itself, rather than through a large Base64 invoke: §9 rules that out, and
// forbids re-reading the screen per pointer move. The URL carries the session id,
// so a frame belonging to a finished session is refused by Rust.

const FRAME_SCHEME = 'nowly-frame';

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
  | { status: 'decoding'; frame: CaptureFrame }
  | { status: 'ready'; frame: CaptureFrame }
  | { status: 'failed' };

export type CaptureFrameResult = CaptureFrameState & {
  onFrameLoad: (image: HTMLImageElement) => Promise<void>;
  onFrameError: () => void;
};

type FrameOutcome = 'pending' | 'verifying' | 'ready' | 'failed';

export function useCaptureFrame(): CaptureFrameResult {
  const [state, setState] = useState<CaptureFrameState>({ status: 'loading' });
  const activeRef = useRef(false);
  const generationRef = useRef(0);
  const frameRef = useRef<CaptureFrame | null>(null);
  const outcomeRef = useRef<FrameOutcome>('pending');

  const reportFailure = useCallback(() => {
    if (
      !activeRef.current ||
      outcomeRef.current === 'failed' ||
      outcomeRef.current === 'ready'
    ) {
      return;
    }
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
    frameRef.current = null;
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    invoke<FramePlan>('describe_capture_frame')
      .then((plan) => {
        if (!active || generationRef.current !== generation) return;
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
        setState({
          status: 'decoding',
          frame
        });
      })
      .catch((error: unknown) => {
        if (!active || generationRef.current !== generation) return;
        // Reported in place as static text, per design.md §11's Error state. The
        // session stays cancellable with Esc.
        console.error('failed to describe the capture frame', error);
        reportFailure();
      });
    return () => {
      active = false;
      activeRef.current = false;
      generationRef.current += 1;
    };
  }, [reportFailure]);

  const onFrameLoad = useCallback(
    async (image: HTMLImageElement) => {
      const generation = generationRef.current;
      const frame = frameRef.current;
      if (!activeRef.current || !frame || outcomeRef.current !== 'pending') return;

      // `load` proves the response completed, but WebView2 may still have an
      // outstanding decode. Native keeps every capture window hidden until this
      // promise settles, so requestAnimationFrame cannot be used as a paint fence.
      outcomeRef.current = 'verifying';
      try {
        if (typeof image.decode !== 'function') {
          throw new Error('the image decoder is unavailable');
        }
        await image.decode();
      } catch (error: unknown) {
        if (
          !activeRef.current ||
          generationRef.current !== generation ||
          outcomeRef.current !== 'verifying'
        ) {
          return;
        }
        console.error('failed to decode the capture frame', error);
        reportFailure();
        return;
      }

      if (
        !activeRef.current ||
        generationRef.current !== generation ||
        outcomeRef.current !== 'verifying'
      ) {
        return;
      }
      if (
        image.naturalWidth <= 0 ||
        image.naturalHeight <= 0 ||
        image.naturalWidth !== frame.width ||
        image.naturalHeight !== frame.height
      ) {
        reportFailure();
        return;
      }

      outcomeRef.current = 'ready';
      setState({ status: 'ready', frame });
      try {
        await invoke('capture_window_ready');
      } catch (error: unknown) {
        if (!activeRef.current || generationRef.current !== generation) return;
        console.error('failed to report the capture window readiness', error);
        outcomeRef.current = 'failed';
        setState({ status: 'failed' });
        void invoke('capture_window_failed').catch((reportError: unknown) => {
          console.error('failed to report the capture window failure', reportError);
        });
      }
    },
    [reportFailure]
  );

  const onFrameError = useCallback(() => {
    reportFailure();
  }, [reportFailure]);

  return { ...state, onFrameLoad, onFrameError };
}

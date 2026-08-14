import { useCallback, useState } from 'react';

// The blur layer sits above the wallpaper image and softens the app content so
// the wallpaper reads as a frosted backdrop. It exposes a single value: how
// many pixels of blur the app content receives. The value is persisted locally
// so a chosen look survives reloads.

export const BLUR_STORAGE_KEY = 'nowly:page-blur';
// Full range: no blur (crisp content) up to a heavy frosted look. Values are in
// CSS blur pixels.
export const MIN_BLUR = 0;
export const MAX_BLUR = 20;
export const DEFAULT_BLUR = 0;

export function clampBlur(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_BLUR;
  return Math.min(MAX_BLUR, Math.max(MIN_BLUR, value));
}

function readStoredBlur(): number {
  try {
    const raw = localStorage.getItem(BLUR_STORAGE_KEY);
    if (raw === null) return DEFAULT_BLUR;
    return clampBlur(Number.parseFloat(raw));
  } catch {
    return DEFAULT_BLUR;
  }
}

export function useBlur() {
  const [blur, setBlurState] = useState<number>(() => readStoredBlur());

  const setBlur = useCallback((value: number) => {
    const next = clampBlur(value);
    setBlurState(next);
    try {
      localStorage.setItem(BLUR_STORAGE_KEY, String(next));
    } catch {
      /* persistence is best-effort; the live value still applies */
    }
  }, []);

  return { blur, setBlur };
}

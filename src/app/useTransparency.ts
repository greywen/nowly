import { useCallback, useState } from 'react';

// The transparency layer sits above the app content and below any wallpaper
// image. It exposes a single value: how opaque the app content stays. Lowering
// opacity reveals the wallpaper layer (or the shell background) beneath the
// modules. The value is persisted locally so a chosen look survives reloads.

export const TRANSPARENCY_STORAGE_KEY = 'nowly:page-opacity';
// Full range: the app content may fade all the way to invisible in wallpaper
// mode (0% opacity = 100% transparency).
export const MIN_OPACITY = 0;
export const MAX_OPACITY = 1;
export const DEFAULT_OPACITY = 1;

export function clampOpacity(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_OPACITY;
  return Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, value));
}

function readStoredOpacity(): number {
  try {
    const raw = localStorage.getItem(TRANSPARENCY_STORAGE_KEY);
    if (raw === null) return DEFAULT_OPACITY;
    return clampOpacity(Number.parseFloat(raw));
  } catch {
    return DEFAULT_OPACITY;
  }
}

export function useTransparency() {
  const [opacity, setOpacityState] = useState<number>(() => readStoredOpacity());

  const setOpacity = useCallback((value: number) => {
    const next = clampOpacity(value);
    setOpacityState(next);
    try {
      localStorage.setItem(TRANSPARENCY_STORAGE_KEY, String(next));
    } catch {
      /* persistence is best-effort; the live value still applies */
    }
  }, []);

  return { opacity, setOpacity };
}

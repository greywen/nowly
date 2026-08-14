import { useCallback, useState } from 'react';

export const BLUR_STORAGE_KEY = 'nowly:page-blur-radius';
export const MIN_BLUR_RADIUS = 0;
export const MAX_BLUR_RADIUS = 24;
export const DEFAULT_BLUR_RADIUS = 0;

export function clampBlurRadius(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_BLUR_RADIUS;
  return Math.min(MAX_BLUR_RADIUS, Math.max(MIN_BLUR_RADIUS, value));
}

function readStoredBlurRadius(): number {
  try {
    const raw = localStorage.getItem(BLUR_STORAGE_KEY);
    if (raw === null) return DEFAULT_BLUR_RADIUS;
    return clampBlurRadius(Number.parseFloat(raw));
  } catch {
    return DEFAULT_BLUR_RADIUS;
  }
}

export function useBlurRadius() {
  const [blurRadius, setBlurRadiusState] = useState<number>(() => readStoredBlurRadius());

  const setBlurRadius = useCallback((value: number) => {
    const next = clampBlurRadius(value);
    setBlurRadiusState(next);
    try {
      localStorage.setItem(BLUR_STORAGE_KEY, String(next));
    } catch {
      /* persistence is best-effort; the live value still applies */
    }
  }, []);

  return { blurRadius, setBlurRadius };
}

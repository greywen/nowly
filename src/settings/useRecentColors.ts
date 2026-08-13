import { useCallback, useState } from 'react';
import { addRecentColor, sanitizeRecentColors, type HexColor } from '../lib/color';

// Recent colors are a lightweight UI convenience, so they live in localStorage
// instead of the app-settings round-trip. That keeps them working in the
// browser dev server and resilient to any backend save failure — a failed
// settings write must never wipe the user's color history.
const STORAGE_KEY = 'nowly.recentColors';

function read(): HexColor[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? sanitizeRecentColors(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function write(colors: readonly HexColor[]) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(colors));
  } catch {
    /* storage unavailable; keep the in-memory list only */
  }
}

export function useRecentColors() {
  const [recentColors, setRecentColors] = useState<HexColor[]>(() => read());
  const rememberColor = useCallback((color: string) => {
    setRecentColors((previous) => {
      const next = addRecentColor(previous, color);
      write(next);
      return next;
    });
  }, []);
  return { recentColors, rememberColor };
}

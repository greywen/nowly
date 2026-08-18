import { useCallback, useState } from 'react';
import { addRecentColor, type HexColor } from '../lib/color';

// Recent colors are a lightweight, session-only UI convenience. They live in
// in-memory React state and are intentionally NOT persisted — the app keeps no
// form caches, so the color history resets every run rather than being restored
// from storage.
export function useRecentColors() {
  const [recentColors, setRecentColors] = useState<HexColor[]>([]);
  const rememberColor = useCallback((color: string) => {
    setRecentColors((previous) => addRecentColor(previous, color));
  }, []);
  return { recentColors, rememberColor };
}

import { useCallback, useState } from 'react';
import {
  canPlace,
  clampToBounds,
  defaultLayout,
  normalizeLayout,
  type LayoutState,
  type WidgetId
} from './widget-registry';

const STORAGE_KEY = 'nowly.module-layout';

function readLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaultLayout;
    return normalizeLayout(JSON.parse(raw));
  } catch {
    return defaultLayout;
  }
}

function writeLayout(layout: LayoutState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // localStorage unavailable: keep in-memory state only.
  }
}

export function useModuleLayout() {
  const [layout, setLayout] = useState<LayoutState>(() => readLayout());

  const commit = useCallback((next: LayoutState) => {
    writeLayout(next);
    setLayout(next);
  }, []);

  // Move `id` so its top-left sits at `{x, y}` (clamped inside the grid),
  // keeping its size. Rejected if the target cells are taken by another module.
  const move = useCallback(
    (id: WidgetId, position: { x: number; y: number }) => {
      setLayout((current) => {
        const item = current.find((entry) => entry.id === id);
        if (!item) return current;
        const target = clampToBounds({ x: position.x, y: position.y, w: item.w, h: item.h });
        if (!canPlace(current, id, target)) return current;
        const next = current.map((entry) => (entry.id === id ? { ...entry, ...target } : entry));
        writeLayout(next);
        return next;
      });
    },
    []
  );

  // Resize `id` to `{w, h}` from its fixed top-left. Rejected if it would spill
  // out of the grid, drop below the module minimum, or overlap another module.
  const resize = useCallback(
    (id: WidgetId, size: { w: number; h: number }) => {
      setLayout((current) => {
        const item = current.find((entry) => entry.id === id);
        if (!item) return current;
        const target = { x: item.x, y: item.y, w: size.w, h: size.h };
        if (!canPlace(current, id, target)) return current;
        const next = current.map((entry) => (entry.id === id ? { ...entry, ...target } : entry));
        writeLayout(next);
        return next;
      });
    },
    []
  );

  const reset = useCallback(() => {
    commit(defaultLayout);
  }, [commit]);

  return { layout, move, resize, reset };
}

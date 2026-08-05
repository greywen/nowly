import { useCallback, useState } from 'react';
import {
  defaultLayout,
  getNextPresetId,
  normalizeLayout,
  reorderLayout,
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

  const persist = useCallback((next: LayoutState) => {
    writeLayout(next);
    setLayout(next);
  }, []);

  const reorder = useCallback((fromId: WidgetId, toId: WidgetId) => {
    setLayout((current) => {
      const next = reorderLayout(current, fromId, toId);
      if (next !== current) writeLayout(next);
      return next;
    });
  }, []);

  const setPreset = useCallback((id: WidgetId, presetId: string) => {
    setLayout((current) => {
      const next = current.map((item) => (item.id === id ? { ...item, presetId } : item));
      writeLayout(next);
      return next;
    });
  }, []);

  const cyclePreset = useCallback((id: WidgetId) => {
    setLayout((current) => {
      const next = current.map((item) =>
        item.id === id ? { ...item, presetId: getNextPresetId(id, item.presetId) } : item
      );
      writeLayout(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    persist(defaultLayout);
  }, [persist]);

  return { layout, reorder, setPreset, cyclePreset, reset };
}

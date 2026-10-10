import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { ModuleLayoutEntry } from '../data/nowly-repository';
import {
  canPlace,
  clampToBounds,
  defaultLayout,
  findFreeSlot,
  getWidgetDefinition,
  normalizeLayout,
  type LayoutState,
  type WidgetDefinition,
  type WidgetId
} from './widget-registry';

function toEntries(layout: LayoutState): ModuleLayoutEntry[] {
  return layout.map((item) => ({ id: item.id, x: item.x, y: item.y, w: item.w, h: item.h }));
}

// Free-form module layout backed by the database. Every module Nowly offers is
// built in, so the definition set is known up front and the rendered layout is
// the single source of truth. Moves/resizes/add/remove persist immediately.
//
// Stored entries whose definition no longer exists (a module removed in a newer
// version) are dropped on load and disappear from the database on the next save.
export function useModuleLayout(definitions: WidgetDefinition[]) {
  const repository = useNowlyRepository();
  const [layout, setLayout] = useState<LayoutState>(() => defaultLayout);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void repository
      .listModuleLayout()
      .then((entries) => {
        if (!active) return;
        setLayout(normalizeLayout(entries, definitions));
        setLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setLoaded(true);
      });
    return () => {
      active = false;
    };
    // Loading only depends on the repository; the definition set is static.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  const persist = useCallback(
    (next: LayoutState) => {
      void repository.saveModuleLayout(toEntries(next)).catch(() => undefined);
    },
    [repository]
  );

  const commit = useCallback(
    (next: LayoutState) => {
      persist(next);
      setLayout(next);
    },
    [persist]
  );

  const move = useCallback(
    (id: WidgetId, position: { x: number; y: number }) => {
      setLayout((current) => {
        const item = current.find((entry) => entry.id === id);
        if (!item) return current;
        const target = clampToBounds({ x: position.x, y: position.y, w: item.w, h: item.h });
        if (!canPlace(current, id, target, definitions)) return current;
        const next = current.map((entry) => (entry.id === id ? { ...entry, ...target } : entry));
        persist(next);
        return next;
      });
    },
    [definitions, persist]
  );

  const resize = useCallback(
    (id: WidgetId, size: { w: number; h: number }) => {
      setLayout((current) => {
        const item = current.find((entry) => entry.id === id);
        if (!item) return current;
        const target = { x: item.x, y: item.y, w: size.w, h: size.h };
        if (!canPlace(current, id, target, definitions)) return current;
        const next = current.map((entry) => (entry.id === id ? { ...entry, ...target } : entry));
        persist(next);
        return next;
      });
    },
    [definitions, persist]
  );

  // Add a module to the layout at the first free slot that fits. Tries the
  // module's default (largest) size first, then falls back to its minimum size
  // so a module still gets placed when only the smallest variant fits. No-op if
  // it is already present or even the minimum size has no room.
  const addWidget = useCallback(
    (id: WidgetId) => {
      setLayout((current) => {
        if (current.some((entry) => entry.id === id)) return current;
        const definition = getWidgetDefinition(id, definitions);
        if (!definition) return current;
        const slot =
          findFreeSlot(current, definition.default.w, definition.default.h) ??
          findFreeSlot(current, definition.minW, definition.minH);
        if (!slot) return current;
        const next = [...current, { id, ...slot }];
        persist(next);
        return next;
      });
    },
    [definitions, persist]
  );

  const removeWidget = useCallback(
    (id: WidgetId) => {
      setLayout((current) => {
        if (!current.some((entry) => entry.id === id)) return current;
        const next = current.filter((entry) => entry.id !== id);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const reset = useCallback(() => {
    commit(defaultLayout);
  }, [commit]);

  const presentIds = useMemo(() => new Set(layout.map((item) => item.id)), [layout]);

  return { layout, loaded, presentIds, move, resize, addWidget, removeWidget, reset };
}

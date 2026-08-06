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

// Free-form module layout backed by the database. Definitions cover built-in,
// extension, and custom-template modules so every module type flows through the
// same placement rules. Moves/resizes/add/remove persist immediately.
export function useModuleLayout(definitions: WidgetDefinition[]) {
  const repository = useNowlyRepository();
  const [layout, setLayout] = useState<LayoutState>(() => defaultLayout);
  const [loaded, setLoaded] = useState(false);

  // Re-normalize whenever definitions change (e.g. a custom template was
  // deleted) so stale entries drop out of the rendered layout.
  const definitionKey = useMemo(() => definitions.map((entry) => entry.id).join('|'), [definitions]);

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
    // Loading only depends on the repository; definition changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  // Drop entries whose definition no longer exists once definitions settle.
  useEffect(() => {
    if (!loaded) return;
    setLayout((current) => {
      const filtered = current.filter((item) => getWidgetDefinition(item.id, definitions));
      return filtered.length === current.length ? current : filtered;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionKey, loaded]);

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

  // Add a module to the layout at the first free slot that fits its default
  // size. No-op if it is already present or the grid has no room.
  const addWidget = useCallback(
    (id: WidgetId) => {
      setLayout((current) => {
        if (current.some((entry) => entry.id === id)) return current;
        const definition = getWidgetDefinition(id, definitions);
        if (!definition) return current;
        const slot = findFreeSlot(current, definition.default.w, definition.default.h);
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

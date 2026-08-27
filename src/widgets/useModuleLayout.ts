import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

  // The authoritative set of placed entries, which is the source of truth for
  // persistence. It may contain entries whose definition has NOT loaded yet —
  // most importantly `sandbox:<id>` modules, whose definitions arrive only after
  // the extensions list resolves. The rendered `layout` is derived from this by
  // normalizing against the definitions known right now. Keeping the raw entries
  // separate is what lets a not-yet-loaded sandbox module survive a save: if we
  // persisted the rendered layout instead, an interim move/resize would write
  // back a layout missing that entry and lose it permanently.
  const entriesRef = useRef<ModuleLayoutEntry[]>(toEntries(defaultLayout));

  // Re-derive the rendered layout whenever definitions change (a custom template
  // was deleted, or a sandbox extension finished loading).
  const definitionKey = useMemo(() => definitions.map((entry) => entry.id).join('|'), [definitions]);

  useEffect(() => {
    let active = true;
    void repository
      .listModuleLayout()
      .then((entries) => {
        if (!active) return;
        entriesRef.current = entries.map((entry) => ({ ...entry }));
        setLayout(normalizeLayout(entriesRef.current, definitions));
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

  // Re-derive the rendered layout when definitions settle. A sandbox module
  // whose definition was unknown at load time reappears here; a genuinely-removed
  // definition drops out of the rendering (its raw entry lingers in entriesRef,
  // harmlessly, and re-materializes if the definition ever comes back).
  useEffect(() => {
    if (!loaded) return;
    setLayout(normalizeLayout(entriesRef.current, definitions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionKey, loaded]);

  // Persist the authoritative entries. Callers first mutate entriesRef, then the
  // rendered layout, then call this — so the database always holds the full set
  // including not-yet-loaded modules.
  const persist = useCallback(() => {
    void repository.saveModuleLayout(entriesRef.current.map((entry) => ({ ...entry }))).catch(() => undefined);
  }, [repository]);

  // Replace a single entry in the authoritative set (preserving order), or drop
  // it when `rect` is null. Unknown-definition entries are left untouched.
  const upsertEntry = useCallback((id: WidgetId, rect: { x: number; y: number; w: number; h: number } | null) => {
    const rest = entriesRef.current.filter((entry) => entry.id !== id);
    entriesRef.current = rect === null ? rest : [...rest, { id, ...rect }];
  }, []);

  const commit = useCallback(
    (next: LayoutState) => {
      entriesRef.current = toEntries(next);
      persist();
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
        upsertEntry(id, target);
        persist();
        return next;
      });
    },
    [definitions, persist, upsertEntry]
  );

  const resize = useCallback(
    (id: WidgetId, size: { w: number; h: number }) => {
      setLayout((current) => {
        const item = current.find((entry) => entry.id === id);
        if (!item) return current;
        const target = { x: item.x, y: item.y, w: size.w, h: size.h };
        if (!canPlace(current, id, target, definitions)) return current;
        const next = current.map((entry) => (entry.id === id ? { ...entry, ...target } : entry));
        upsertEntry(id, target);
        persist();
        return next;
      });
    },
    [definitions, persist, upsertEntry]
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
        upsertEntry(id, slot);
        persist();
        return next;
      });
    },
    [definitions, persist, upsertEntry]
  );

  const removeWidget = useCallback(
    (id: WidgetId) => {
      setLayout((current) => {
        if (!current.some((entry) => entry.id === id)) return current;
        const next = current.filter((entry) => entry.id !== id);
        upsertEntry(id, null);
        persist();
        return next;
      });
    },
    [persist, upsertEntry]
  );

  const reset = useCallback(() => {
    commit(defaultLayout);
  }, [commit]);

  const presentIds = useMemo(() => new Set(layout.map((item) => item.id)), [layout]);

  return { layout, loaded, presentIds, move, resize, addWidget, removeWidget, reset };
}

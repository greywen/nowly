import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';

// The host API a runnable module receives. It is the entire surface a module is
// allowed to touch: identity, today's date, and its own persisted state. Keeping
// modules to this contract (rather than reaching into the app directly) is what
// lets a future version run them inside a sandbox that speaks the same API.
export type ModuleHost = {
  // The module's stable widget id (also the key its state is stored under).
  moduleId: string;
  // Local ISO date (YYYY-MM-DD) for "daily" modules; stable within a day.
  todayIso: string;
  // Load this module's persisted JSON state, parsed. Returns null when unset.
  loadState<T>(): Promise<T | null>;
  // Persist this module's state as JSON. Overwrites the previous value.
  saveState<T>(value: T): Promise<void>;
};

// A runnable module: placement metadata lives in the widget registry; this pairs
// an id with the component that renders it given a host.
export type ExtensionModuleComponent = (props: { host: ModuleHost }) => ReactElement;

// Builds a host bound to one module id. `todayIso` is passed in so every module
// shares the app's notion of "today" and the host stays stable across renders.
export function createModuleHost(
  repository: NowlyRepository,
  moduleId: string,
  todayIso: string
): ModuleHost {
  return {
    moduleId,
    todayIso,
    async loadState<T>(): Promise<T | null> {
      const raw = await repository.getModuleState(moduleId);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        // Corrupt or hand-edited state should not crash the module.
        return null;
      }
    },
    async saveState<T>(value: T): Promise<void> {
      await repository.setModuleState(moduleId, JSON.stringify(value));
    }
  };
}

// React helper for the common "load once, then persist on change" pattern. It
// keeps a synchronous local copy for rendering and writes through the host on
// every update. `fallback` is used until the stored value loads (or when unset).
export function useModuleState<T>(
  host: ModuleHost,
  fallback: T
): [T, (next: T | ((current: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);
  const valueRef = useRef<T>(fallback);
  valueRef.current = value;

  useEffect(() => {
    let active = true;
    void host.loadState<T>().then((stored) => {
      if (!active) return;
      if (stored !== null) {
        setValue(stored);
        valueRef.current = stored;
      }
      setLoaded(true);
    });
    return () => {
      active = false;
    };
    // Re-run only when the module identity changes.
  }, [host.moduleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      const resolved =
        typeof next === 'function' ? (next as (current: T) => T)(valueRef.current) : next;
      valueRef.current = resolved;
      setValue(resolved);
      void host.saveState(resolved);
    },
    [host]
  );

  return [value, update, loaded];
}

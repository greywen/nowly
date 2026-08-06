import { useCallback, useEffect, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { SandboxExtension, SandboxExtensionDraft } from '../data/nowly-repository';

// Loads and mutates installed sandbox extensions from the database. Mirrors
// install/uninstall are independent of layout placement.
export function useExtensions() {
  const repository = useNowlyRepository();
  const [extensions, setExtensions] = useState<SandboxExtension[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setExtensions(await repository.listExtensions());
    } catch {
      // Leave the last known list in place on failure.
    } finally {
      setLoaded(true);
    }
  }, [repository]);

  useEffect(() => {
    void load();
  }, [load]);

  const install = useCallback(
    async (draft: SandboxExtensionDraft) => {
      const installed = await repository.installExtension(draft);
      setExtensions((current) => [...current, installed]);
      return installed;
    },
    [repository]
  );

  const uninstall = useCallback(
    async (id: string) => {
      await repository.uninstallExtension(id);
      setExtensions((current) => current.filter((entry) => entry.id !== id));
    },
    [repository]
  );

  return { extensions, loaded, install, uninstall, reload: load };
}

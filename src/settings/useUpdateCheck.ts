import { useEffect, useState } from 'react';
import type { UpdateInfo } from '../data/nowly-repository';
import { useNowlyRepository } from '../data/RepositoryContext';

// Check GitHub for a newer release once on launch. The result feeds both the
// About dialog (current version + latest changelog) and the topbar logo badge
// (a red dot when a newer version exists). A failed or missing check simply
// leaves `info` null, so the UI falls back to the injected build version and
// shows no update dot — reaching GitHub is best-effort, never blocking.
export function useUpdateCheck() {
  const repository = useNowlyRepository();
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    const checkForUpdate = repository.checkForUpdate;
    if (!checkForUpdate) return;
    let cancelled = false;
    void checkForUpdate()
      .then((result) => {
        if (!cancelled) setInfo(result);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  return info;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppVersionInfo, UpdateInfo } from '../data/nowly-repository';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t } from '../i18n';

export type UpdateCheckState = {
  version: AppVersionInfo | null;
  status: 'loading' | 'checking' | 'error' | UpdateInfo['status'];
  error: string | null;
  updateAvailable: boolean;
  retry(): void | Promise<void>;
  openStore(): void | Promise<void>;
  opening: boolean;
  openError: string | null;
  openedInBrowser: boolean;
};

function message(error: unknown, fallback: string) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message : fallback;
}

export function useUpdateCheck(): UpdateCheckState {
  const repository = useNowlyRepository();
  const [version, setVersion] = useState<AppVersionInfo | null>(null);
  const [status, setStatus] = useState<UpdateCheckState['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openedInBrowser, setOpenedInBrowser] = useState(false);
  const generation = useRef(0);
  const lifetime = useRef(0);
  const pending = useRef(false);
  const openingRef = useRef(false);

  const retry = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    const request = ++generation.current;
    setError(null);
    setStatus('loading');
    try {
      if (!repository.getAppVersionInfo) throw new Error(t('about.versionError'));
      const local = await repository.getAppVersionInfo();
      if (request !== generation.current) return;
      setVersion(local);
      if (local.distribution !== 'msix') {
        setStatus('unsupported');
        return;
      }
      setStatus('checking');
      if (!repository.checkForUpdate) throw new Error(t('about.checkError'));
      // The native command cancels the Store operation after 15 seconds.
      const result = await repository.checkForUpdate();
      if (request === generation.current) setStatus(result.status);
    } catch (reason) {
      if (request === generation.current) {
        setStatus('error');
        setError(message(reason, t('about.checkError')));
      }
    } finally {
      if (request === generation.current) pending.current = false;
    }
  }, [repository]);

  useEffect(() => {
    setVersion(null);
    void retry();
    setOpening(false);
    setOpenError(null);
    setOpenedInBrowser(false);
    return () => { generation.current++; lifetime.current++; pending.current = false; openingRef.current = false; };
  }, [retry]);

  const openStore = useCallback(async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    const request = lifetime.current;
    setOpening(true);
    setOpenError(null);
    setOpenedInBrowser(false);
    try {
      if (!repository.openStorePage) throw new Error(t('about.openError'));
      const result = await repository.openStorePage();
      if (request === lifetime.current) setOpenedInBrowser(result.openedInBrowser);
    } catch (reason) {
      if (request === lifetime.current) setOpenError(message(reason, t('about.openError')));
    } finally {
      if (request === lifetime.current) {
        openingRef.current = false;
        setOpening(false);
      }
    }
  }, [repository]);

  return { version, status, error, updateAvailable: status === 'available', retry, openStore,
    opening, openError, openedInBrowser };
}

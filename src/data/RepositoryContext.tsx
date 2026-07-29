import { createContext, useContext, type ReactNode } from 'react';
import type { NowlyRepository } from './nowly-repository';
import { tauriNowlyRepository } from './tauri-nowly-repository';

const RepositoryContext = createContext<NowlyRepository>(tauriNowlyRepository);

export function RepositoryProvider({
  repository,
  children
}: {
  repository: NowlyRepository;
  children: ReactNode;
}) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useNowlyRepository() {
  return useContext(RepositoryContext);
}

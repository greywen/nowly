import { useCallback, useEffect, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { Category, CategoryDraft } from './calendar-model';

// Categories are user-defined records shared by calendar events and
// subscriptions. This hook owns the single loaded list plus the CRUD calls, so
// every surface (event editor, subscription form) reads and mutates the same
// source. The list reloads after each write so freshly created/edited/deleted
// categories appear at once.
export function useCategories() {
  const repository = useNowlyRepository();
  const [categories, setCategories] = useState<Category[]>([]);

  const reload = useCallback(() => {
    void repository
      .listCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [repository]);

  useEffect(() => {
    reload();
  }, [reload]);

  const createCategory = useCallback(
    async (draft: CategoryDraft) => {
      const created = await repository.createCategory(draft);
      reload();
      return created;
    },
    [repository, reload]
  );

  const updateCategory = useCallback(
    async (id: string, draft: CategoryDraft) => {
      const updated = await repository.updateCategory(id, draft);
      reload();
      return updated;
    },
    [repository, reload]
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      await repository.deleteCategory(id);
      reload();
    },
    [repository, reload]
  );

  return { categories, reloadCategories: reload, createCategory, updateCategory, deleteCategory };
}

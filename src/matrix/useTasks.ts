import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { sortTasks } from '../lib/task-draft';
import type { MatrixTask, TaskDraft } from './matrix-model';

type TasksResource =
  | { status: 'loading'; data: MatrixTask[] }
  | { status: 'ready'; data: MatrixTask[] }
  | { status: 'error'; data: MatrixTask[]; message: string };

function messageFrom(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return '无法读取本地任务，请重试。';
}

export function useTasks({ onRefreshEvents }: { onRefreshEvents: () => Promise<unknown> }) {
  const repository = useNowlyRepository();
  const [tasks, setTasks] = useState<TasksResource>({ status: 'loading', data: [] });
  const requestIdRef = useRef(0);

  const loadTasks = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setTasks((current) => ({ status: 'loading', data: current.data }));
    try {
      const data = sortTasks(await repository.listTasks());
      if (requestId === requestIdRef.current) {
        setTasks({ status: 'ready', data });
      }
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setTasks((current) => ({ status: 'error', data: current.data, message: messageFrom(error) }));
      }
    }
  }, [repository]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const refreshAfterWrite = useCallback(
    async (refreshEvents: boolean) => {
      await loadTasks();
      if (refreshEvents) await onRefreshEvents();
    },
    [loadTasks, onRefreshEvents]
  );

  const createTask = useCallback(
    async (draft: TaskDraft) => {
      const created = await repository.createTask(draft);
      await refreshAfterWrite(created.linkedEventId !== null);
      return created;
    },
    [refreshAfterWrite, repository]
  );

  const updateTask = useCallback(
    async (task: MatrixTask, draft: TaskDraft) => {
      const updated = await repository.updateTask(task.id, draft);
      await refreshAfterWrite(task.linkedEventId !== updated.linkedEventId);
      return updated;
    },
    [refreshAfterWrite, repository]
  );

  const deleteTask = useCallback(
    async (task: MatrixTask) => {
      await repository.deleteTask(task.id);
      await refreshAfterWrite(task.linkedEventId !== null);
    },
    [refreshAfterWrite, repository]
  );

  return {
    tasks,
    retryTasks: loadTasks,
    createTask,
    updateTask,
    deleteTask
  };
}

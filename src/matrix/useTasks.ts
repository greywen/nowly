import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { sortTasks } from '../lib/task-draft';
import { t } from '../i18n';
import type { MatrixTask, TaskDraft } from './matrix-model';

type TasksResource =
  | { status: 'loading'; data: MatrixTask[] }
  | { status: 'ready'; data: MatrixTask[] }
  | { status: 'error'; data: MatrixTask[]; message: string };

type FailedCompletion = {
  taskId: string;
  targetCompleted: boolean;
  revision: number;
  message: string;
};

function messageFrom(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return t('matrix.readError');
}

export function useTasks({ onRefreshEvents }: { onRefreshEvents: () => Promise<unknown> }) {
  const repository = useNowlyRepository();
  const [tasks, setTasks] = useState<TasksResource>({ status: 'loading', data: [] });
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(new Set());
  const [failedCompletion, setFailedCompletion] = useState<FailedCompletion | null>(null);
  const requestIdRef = useRef(0);
  const tasksRef = useRef<MatrixTask[]>([]);
  const revisionsRef = useRef(new Map<string, number>());
  const pendingTaskIdsRef = useRef(new Set<string>());

  const replaceTasks = useCallback((data: MatrixTask[]) => {
    const sorted = sortTasks(data);
    tasksRef.current = sorted;
    setTasks({ status: 'ready', data: sorted });
  }, []);

  const nextRevision = useCallback((id: string) => {
    const revision = (revisionsRef.current.get(id) ?? 0) + 1;
    revisionsRef.current.set(id, revision);
    return revision;
  }, []);

  const setPending = useCallback((id: string, pending: boolean) => {
    const next = new Set(pendingTaskIdsRef.current);
    if (pending) next.add(id);
    else next.delete(id);
    pendingTaskIdsRef.current = next;
    setPendingTaskIds(next);
  }, []);

  const loadTasks = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setTasks((current) => ({ status: 'loading', data: current.data }));
    try {
      const data = await repository.listTasks();
      if (requestId === requestIdRef.current) replaceTasks(data);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setTasks((current) => ({ status: 'error', data: current.data, message: messageFrom(error) }));
      }
    }
  }, [replaceTasks, repository]);

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
      nextRevision(task.id);
      await refreshAfterWrite(task.linkedEventId !== updated.linkedEventId);
      return updated;
    },
    [nextRevision, refreshAfterWrite, repository]
  );

  const deleteTask = useCallback(
    async (task: MatrixTask) => {
      await repository.deleteTask(task.id);
      nextRevision(task.id);
      await refreshAfterWrite(task.linkedEventId !== null);
    },
    [nextRevision, refreshAfterWrite, repository]
  );

  const setTaskCompleted = useCallback(
    async (task: MatrixTask, completed: boolean) => {
      if (pendingTaskIdsRef.current.has(task.id)) return;
      const revision = nextRevision(task.id);
      const original = tasksRef.current.find((item) => item.id === task.id) ?? task;
      setFailedCompletion(null);
      setPending(task.id, true);
      replaceTasks(tasksRef.current.map((item) =>
        item.id === task.id ? { ...item, completed } : item
      ));
      try {
        const saved = await repository.setTaskCompleted(task.id, completed);
        if (revisionsRef.current.get(task.id) === revision) {
          replaceTasks(tasksRef.current.map((item) => item.id === task.id ? saved : item));
          setFailedCompletion(null);
        }
      } catch (error) {
        if (revisionsRef.current.get(task.id) === revision) {
          replaceTasks(tasksRef.current.map((item) => item.id === task.id ? original : item));
          setFailedCompletion({
            taskId: task.id,
            targetCompleted: completed,
            revision,
            message: messageFrom(error)
          });
        }
      } finally {
        setPending(task.id, false);
      }
    },
    [nextRevision, replaceTasks, repository, setPending]
  );

  const retryFailedCompletion = useCallback(async () => {
    const failed = failedCompletion;
    if (!failed) return;
    const current = tasksRef.current.find((task) => task.id === failed.taskId);
    if (!current || revisionsRef.current.get(failed.taskId) !== failed.revision) {
      setFailedCompletion(null);
      await loadTasks();
      return;
    }
    await setTaskCompleted(current, failed.targetCompleted);
  }, [failedCompletion, loadTasks, setTaskCompleted]);

  const dismissTaskError = useCallback(() => setFailedCompletion(null), []);

  return {
    tasks,
    retryTasks: loadTasks,
    createTask,
    updateTask,
    deleteTask,
    setTaskCompleted,
    retryFailedCompletion,
    dismissTaskError,
    pendingTaskIds,
    failedCompletion
  };
}

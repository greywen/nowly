import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t } from '../i18n';
import {
  emptyTaskWorkspace,
  normalizeTaskWorkspace,
  sortTaskWorkspace,
  type Task,
  type TaskDraft,
  type TaskLane,
  type TaskLaneDraft,
  type TaskPriority,
  type TaskTagDraft,
  type TaskViewPreferences,
  type TaskWorkspaceSnapshot
} from './task-model';
import {
  legacyPriority,
  matrixDraftToWorkspace,
  taskToMatrixTask,
  workspaceFromLegacy
} from './task-projections';

type WorkspaceResource =
  | { status: 'loading'; data: TaskWorkspaceSnapshot }
  | { status: 'ready'; data: TaskWorkspaceSnapshot }
  | { status: 'error'; data: TaskWorkspaceSnapshot; message: string };

type TaskWorkspaceContextValue = {
  workspace: WorkspaceResource;
  pendingTaskIds: Set<string>;
  operationError: string | null;
  retry(): Promise<void>;
  refresh(): Promise<void>;
  dismissOperationError(): void;
  createTask(draft: TaskDraft): Promise<Task>;
  updateTask(id: string, draft: TaskDraft): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  setTaskCompleted(id: string, completed: boolean): Promise<Task>;
  moveTaskToLane(id: string, laneId: string, targetIndex: number): Promise<Task>;
  moveTaskToPriority(id: string, priority: TaskPriority): Promise<Task>;
  moveTaskToDate(id: string, dueDate: string | null): Promise<Task>;
  createLane(draft: TaskLaneDraft): Promise<TaskLane>;
  updateLane(id: string, draft: TaskLaneDraft): Promise<void>;
  deleteLane(id: string): Promise<void>;
  reorderLanes(orderedIds: string[]): Promise<void>;
  setDefaultLane(id: string): Promise<void>;
  createTag(draft: TaskTagDraft): Promise<void>;
  updateTag(id: string, draft: TaskTagDraft): Promise<void>;
  archiveTag(id: string, archived: boolean): Promise<void>;
  deleteTag(id: string): Promise<void>;
  setViewPreferences(preferences: TaskViewPreferences): Promise<void>;
};

const TaskWorkspaceContext = createContext<TaskWorkspaceContextValue | null>(null);

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('matrix.readError');
}

function renumberLane(tasks: Task[], laneId: string): Task[] {
  const order = tasks
    .filter((task) => task.laneId === laneId)
    .sort((a, b) => a.boardPosition - b.boardPosition || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const positions = new Map(order.map((task, index) => [task.id, index]));
  return tasks.map((task) => positions.has(task.id) ? { ...task, boardPosition: positions.get(task.id)! } : task);
}

function missing(name: string): never {
  throw new Error(`Task workspace repository method is unavailable: ${name}`);
}

export function TaskWorkspaceProvider({ children }: { children: ReactNode }) {
  const repository = useNowlyRepository();
  const [workspace, setWorkspace] = useState<WorkspaceResource>({
    status: 'loading',
    data: emptyTaskWorkspace()
  });
  const [pendingTaskIds, setPendingTaskIds] = useState(new Set<string>());
  const [operationError, setOperationError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const dataRef = useRef(workspace.data);

  const applySnapshot = useCallback((snapshot: TaskWorkspaceSnapshot) => {
    const sorted = sortTaskWorkspace(normalizeTaskWorkspace(snapshot));
    dataRef.current = sorted;
    setWorkspace({ status: 'ready', data: sorted });
    return sorted;
  }, []);

  const patchSnapshot = useCallback((patch: (current: TaskWorkspaceSnapshot) => TaskWorkspaceSnapshot) => {
    applySnapshot(patch(dataRef.current));
  }, [applySnapshot]);

  const replaceTask = useCallback((task: Task) => {
    patchSnapshot((current) => ({
      ...current,
      tasks: current.tasks.some((item) => item.id === task.id)
        ? current.tasks.map((item) => item.id === task.id ? task : item)
        : [...current.tasks, task]
    }));
  }, [patchSnapshot]);

  const setPending = useCallback((id: string, pending: boolean) => {
    setPendingTaskIds((current) => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const readWorkspace = useCallback(async (silent: boolean) => {
    const requestId = ++requestIdRef.current;
    if (!silent) setWorkspace((current) => ({ status: 'loading', data: current.data }));
    try {
      const snapshot = repository.getTaskWorkspaceSnapshot
        ? await repository.getTaskWorkspaceSnapshot()
        : workspaceFromLegacy(
            await repository.listTasks(),
            await repository.getKanbanSnapshot()
          );
      if (requestId === requestIdRef.current) applySnapshot(snapshot);
    } catch (error) {
      // A silent refresh keeps what is on screen; only an explicit read reports the failure.
      if (!silent && requestId === requestIdRef.current) {
        setWorkspace((current) => ({ status: 'error', data: current.data, message: messageFrom(error) }));
      }
    }
  }, [applySnapshot, repository]);
  const retry = useCallback(() => readWorkspace(false), [readWorkspace]);
  // For tasks written by another window.
  const refresh = useCallback(() => readWorkspace(true), [readWorkspace]);

  useEffect(() => { void retry(); }, [retry]);

  const taskWrite = useCallback(async (
    id: string | null,
    operation: () => Promise<Task>,
    rollbackSnapshot = dataRef.current
  ) => {
    const previous = rollbackSnapshot;
    if (id) setPending(id, true);
    setOperationError(null);
    try {
      const task = await operation();
      replaceTask(task);
      return task;
    } catch (error) {
      applySnapshot(previous);
      setOperationError(messageFrom(error));
      throw error;
    } finally {
      if (id) setPending(id, false);
    }
  }, [applySnapshot, replaceTask, setPending]);

  const createTask = useCallback((draft: TaskDraft) => {
    if (repository.createWorkspaceTask) {
      return taskWrite(null, () => repository.createWorkspaceTask!(draft));
    }
    return taskWrite(null, async () => {
      const matrixDraft = {
        title: draft.title,
        quadrant: draft.priority,
        dueAt: draft.dueDate,
        priority: legacyPriority(draft.priority),
        completed: draft.completed,
        note: draft.description
      };
      const created = await repository.createTask(matrixDraft);
      const projected = workspaceFromLegacy([created], {
        lanes: dataRef.current.lanes,
        cards: [],
        priorities: [],
        tags: dataRef.current.tags.map(({ archivedAt: _archivedAt, ...tag }) => tag)
      });
      return projected.tasks[0];
    });
  }, [repository, taskWrite]);

  const updateTask = useCallback((id: string, draft: TaskDraft) => {
    if (repository.updateWorkspaceTask) {
      return taskWrite(id, () => repository.updateWorkspaceTask!(id, draft));
    }
    return taskWrite(id, async () => {
      const current = dataRef.current.tasks.find((task) => task.id === id);
      const matrixDraft = {
        title: draft.title,
        quadrant: draft.priority,
        dueAt: draft.dueDate,
        priority: legacyPriority(draft.priority),
        completed: draft.completed,
        note: draft.description
      };
      const updated = await repository.updateTask(id, matrixDraft);
      return {
            ...(current ?? workspaceFromLegacy([updated], { lanes: [], cards: [], priorities: [], tags: [] }).tasks[0]),
            ...matrixDraftToWorkspace(matrixDraft, current, dataRef.current),
            id,
            createdAt: current?.createdAt ?? updated.createdAt,
            updatedAt: updated.updatedAt,
            boardPosition: current?.boardPosition ?? 0,
            steps: current?.steps ?? []
          };
    });
  }, [repository, taskWrite]);

  const deleteTask = useCallback(async (id: string) => {
    const write = repository.deleteWorkspaceTask ?? repository.deleteTask;
    const previous = dataRef.current;
    setPending(id, true);
    setOperationError(null);
    patchSnapshot((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== id) }));
    try {
      await write(id);
    } catch (error) {
      applySnapshot(previous);
      setOperationError(messageFrom(error));
      throw error;
    } finally {
      setPending(id, false);
    }
  }, [applySnapshot, patchSnapshot, repository, setPending]);

  const setTaskCompleted = useCallback((id: string, completed: boolean) => {
    if (repository.setWorkspaceTaskCompleted) {
      // Optimistic so a card dropped on the board's done zone leaves its lane
      // at once instead of snapping back until the write returns.
      const previous = dataRef.current;
      patchSnapshot((current) => {
        const target = current.tasks.find((task) => task.id === id);
        if (!target || target.completed === completed) return current;
        const tasks = current.tasks.map((task) => task.id === id
          ? {
              ...task,
              completed,
              completedAt: completed ? new Date().toISOString() : null,
              // Reopening returns the task to the top of its lane.
              boardPosition: !completed && task.laneId ? -1 : task.boardPosition
            }
          : task);
        return { ...current, tasks: !completed && target.laneId ? renumberLane(tasks, target.laneId) : tasks };
      });
      return taskWrite(id, () => repository.setWorkspaceTaskCompleted!(id, completed), previous);
    }
    return taskWrite(id, async () => {
      const saved = await repository.setTaskCompleted(id, completed);
      const current = dataRef.current.tasks.find((task) => task.id === id);
      if (!current) return workspaceFromLegacy([saved], { lanes: [], cards: [], priorities: [], tags: [] }).tasks[0];
      return {
        ...current,
        completed: saved.completed,
        completedAt: saved.completed ? current.completedAt ?? saved.updatedAt : null,
        updatedAt: saved.updatedAt
      };
    });
  }, [patchSnapshot, repository, taskWrite]);

  const moveTaskToLane = useCallback((id: string, laneId: string, targetIndex: number) => {
    const write = repository.moveTaskToLane ?? (() => missing('moveTaskToLane'));
    const previous = dataRef.current;
    const moving = previous.tasks.find((task) => task.id === id);
    if (moving) {
      // `targetIndex` counts open cards; completed cards keep their lane after
      // them. Moving a task into a lane reopens it, as the backend does.
      const inLane = previous.tasks
        .filter((task) => task.id !== id && task.laneId === laneId)
        .sort((a, b) => a.boardPosition - b.boardPosition);
      const open = inLane.filter((task) => !task.completed);
      open.splice(Math.max(0, Math.min(targetIndex, open.length)), 0, moving);
      const positions = new Map([...open, ...inLane.filter((task) => task.completed)].map((task, index) => [task.id, index]));
      patchSnapshot((current) => ({
        ...current,
        tasks: current.tasks.map((task) => task.id === id
          ? { ...task, laneId, completed: false, completedAt: null, boardPosition: positions.get(task.id) ?? task.boardPosition }
          : task.laneId === laneId ? { ...task, boardPosition: positions.get(task.id) ?? task.boardPosition } : task)
      }));
    }
    return taskWrite(id, () => write(id, laneId, targetIndex), previous);
  }, [patchSnapshot, repository, taskWrite]);

  const moveTaskToPriority = useCallback((id: string, priority: TaskPriority) => {
    const write = repository.moveTaskToPriority ?? (() => missing('moveTaskToPriority'));
    return taskWrite(id, () => write(id, priority));
  }, [repository, taskWrite]);

  const moveTaskToDate = useCallback((id: string, dueDate: string | null) => {
    const write = repository.moveTaskToDate ?? (() => missing('moveTaskToDate'));
    return taskWrite(id, () => write(id, dueDate));
  }, [repository, taskWrite]);

  const snapshotWrite = useCallback(async (operation: () => Promise<TaskWorkspaceSnapshot>) => {
    setOperationError(null);
    try {
      return applySnapshot(await operation());
    } catch (error) {
      setOperationError(messageFrom(error));
      throw error;
    }
  }, [applySnapshot]);

  const reloadAfter = useCallback(async (operation: () => Promise<unknown>) => {
    setOperationError(null);
    try {
      await operation();
      await retry();
    } catch (error) {
      setOperationError(messageFrom(error));
      throw error;
    }
  }, [retry]);

  const value = useMemo<TaskWorkspaceContextValue>(() => ({
    workspace,
    pendingTaskIds,
    operationError,
    retry,
    refresh,
    dismissOperationError: () => setOperationError(null),
    createTask,
    updateTask,
    deleteTask,
    setTaskCompleted,
    moveTaskToLane,
    moveTaskToPriority,
    moveTaskToDate,
    createLane: async (draft) => {
      let created: TaskLane | undefined;
      await reloadAfter(async () => {
        created = await (repository.createTaskLane ?? (() => missing('createTaskLane')))(draft);
      });
      return created!;
    },
    updateLane: (id, draft) => reloadAfter(() => (repository.updateTaskLane ?? (() => missing('updateTaskLane')))(id, draft)),
    deleteLane: (id) => snapshotWrite(() => (repository.deleteTaskLane ?? (() => missing('deleteTaskLane')))(id)).then(() => undefined),
    reorderLanes: (orderedIds) => reloadAfter(() => (repository.reorderTaskLanes ?? (() => missing('reorderTaskLanes')))(orderedIds)),
    setDefaultLane: (id) => snapshotWrite(() => (repository.setDefaultTaskLane ?? (() => missing('setDefaultTaskLane')))(id)).then(() => undefined),
    createTag: (draft) => reloadAfter(() => (repository.createTaskTag ?? (() => missing('createTaskTag')))(draft)),
    updateTag: (id, draft) => reloadAfter(() => (repository.updateTaskTag ?? (() => missing('updateTaskTag')))(id, draft)),
    archiveTag: (id, archived) => reloadAfter(() => (repository.archiveTaskTag ?? (() => missing('archiveTaskTag')))(id, archived)),
    deleteTag: (id) => reloadAfter(() => (repository.deleteTaskTag ?? (() => missing('deleteTaskTag')))(id)),
    setViewPreferences: (preferences) => snapshotWrite(() => (repository.setTaskViewPreferences ?? (() => missing('setTaskViewPreferences')))(preferences)).then(() => undefined)
  }), [
    workspace, pendingTaskIds, operationError, retry, refresh, createTask, updateTask, deleteTask,
    setTaskCompleted, moveTaskToLane, moveTaskToPriority, moveTaskToDate,
    snapshotWrite, reloadAfter, repository
  ]);

  return <TaskWorkspaceContext.Provider value={value}>{children}</TaskWorkspaceContext.Provider>;
}

export function useTaskWorkspace() {
  const value = useContext(TaskWorkspaceContext);
  if (!value) throw new Error('useTaskWorkspace must be used inside TaskWorkspaceProvider');
  return value;
}

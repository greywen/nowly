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
  sortTaskWorkspace,
  type Task,
  type TaskCollaboratorDraft,
  type TaskDraft,
  type TaskLaneDraft,
  type TaskPriority,
  type TaskTagDraft,
  type TaskView,
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
  dismissOperationError(): void;
  createTask(originView: TaskView, draft: TaskDraft): Promise<Task>;
  updateTask(id: string, draft: TaskDraft): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  setTaskCompleted(id: string, completed: boolean): Promise<Task>;
  moveTaskToLane(id: string, laneId: string, targetIndex: number): Promise<Task>;
  moveTaskToPriority(id: string, priority: TaskPriority | null): Promise<Task>;
  moveTaskToDate(id: string, dueDate: string | null): Promise<Task>;
  setTaskViewMemberships(id: string, views: TaskView[]): Promise<Task>;
  setTaskViewLinking(enabled: boolean): Promise<TaskWorkspaceSnapshot>;
  createLane(draft: TaskLaneDraft): Promise<void>;
  updateLane(id: string, draft: TaskLaneDraft): Promise<void>;
  deleteLane(id: string, replacementLaneId?: string | null): Promise<void>;
  reorderLanes(orderedIds: string[]): Promise<void>;
  setDefaultLane(id: string): Promise<void>;
  setCompletionLane(id: string): Promise<void>;
  createTag(draft: TaskTagDraft): Promise<void>;
  updateTag(id: string, draft: TaskTagDraft): Promise<void>;
  archiveTag(id: string, archived: boolean): Promise<void>;
  deleteTag(id: string): Promise<void>;
  createCollaborator(draft: TaskCollaboratorDraft): Promise<void>;
  updateCollaborator(id: string, draft: TaskCollaboratorDraft): Promise<void>;
  archiveCollaborator(id: string, archived: boolean): Promise<void>;
  deleteCollaborator(id: string): Promise<void>;
  setViewPreferences(preferences: TaskViewPreferences): Promise<void>;
};

const TaskWorkspaceContext = createContext<TaskWorkspaceContextValue | null>(null);

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('matrix.readError');
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
    const sorted = sortTaskWorkspace(snapshot);
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

  const retry = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setWorkspace((current) => ({ status: 'loading', data: current.data }));
    try {
      const snapshot = repository.getTaskWorkspaceSnapshot
        ? await repository.getTaskWorkspaceSnapshot()
        : workspaceFromLegacy(
            await repository.listTasks(),
            await repository.getKanbanSnapshot()
          );
      if (requestId === requestIdRef.current) applySnapshot(snapshot);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setWorkspace((current) => ({ status: 'error', data: current.data, message: messageFrom(error) }));
      }
    }
  }, [applySnapshot, repository]);

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

  const createTask = useCallback((originView: TaskView, draft: TaskDraft) => {
    if (repository.createWorkspaceTask) {
      return taskWrite(null, () => repository.createWorkspaceTask!(originView, draft));
    }
    return taskWrite(null, async () => {
      const matrixDraft = {
        title: draft.title,
        quadrant: draft.priority ?? 'important_urgent' as const,
        dueAt: draft.dueDate,
        priority: draft.priority ? legacyPriority(draft.priority) : 2 as const,
        completed: draft.completed,
        linkedEventId: draft.linkedEventId,
        note: draft.description
      };
      const created = await repository.createTask(matrixDraft);
      const projected = workspaceFromLegacy([created], {
        lanes: dataRef.current.lanes,
        cards: [],
        priorities: [],
        tags: dataRef.current.tags.map(({ archivedAt: _archivedAt, ...tag }) => tag),
        collaborators: dataRef.current.collaborators.map(({ archivedAt: _archivedAt, ...person }) => person)
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
        quadrant: draft.priority ?? current?.priority ?? 'important_urgent',
        dueAt: draft.dueDate,
        priority: draft.priority ? legacyPriority(draft.priority) : 2 as const,
        completed: draft.completed,
        linkedEventId: draft.linkedEventId,
        note: draft.description
      };
      const updated = await repository.updateTask(id, matrixDraft);
      return matrixDraftToWorkspace(matrixDraft, current, dataRef.current).priority
        ? {
            ...(current ?? workspaceFromLegacy([updated], { lanes: [], cards: [], priorities: [], tags: [], collaborators: [] }).tasks[0]),
            ...matrixDraftToWorkspace(matrixDraft, current, dataRef.current),
            id,
            createdAt: current?.createdAt ?? updated.createdAt,
            updatedAt: updated.updatedAt,
            boardPosition: current?.boardPosition ?? 0,
            views: current?.views ?? ['kanban', 'matrix']
          }
        : missing('legacy update projection');
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
      return taskWrite(id, () => repository.setWorkspaceTaskCompleted!(id, completed));
    }
    return taskWrite(id, async () => {
      const saved = await repository.setTaskCompleted(id, completed);
      const current = dataRef.current.tasks.find((task) => task.id === id);
      if (!current) return workspaceFromLegacy([saved], { lanes: [], cards: [], priorities: [], tags: [], collaborators: [] }).tasks[0];
      return {
        ...current,
        completed: saved.completed,
        laneId: saved.completed ? dataRef.current.completionLaneId : dataRef.current.defaultLaneId,
        updatedAt: saved.updatedAt
      };
    });
  }, [repository, taskWrite]);

  const moveTaskToLane = useCallback((id: string, laneId: string, targetIndex: number) => {
    const write = repository.moveTaskToLane ?? (() => missing('moveTaskToLane'));
    const previous = dataRef.current;
    const moving = previous.tasks.find((task) => task.id === id);
    if (moving) {
      const others = previous.tasks.filter((task) => task.id !== id);
      const target = others.filter((task) => task.laneId === laneId).sort((a, b) => a.boardPosition - b.boardPosition);
      target.splice(Math.max(0, Math.min(targetIndex, target.length)), 0, { ...moving, laneId });
      const positions = new Map(target.map((task, index) => [task.id, index]));
      patchSnapshot((current) => ({
        ...current,
        tasks: current.tasks.map((task) => task.id === id
          ? { ...task, laneId, boardPosition: positions.get(task.id) ?? task.boardPosition }
          : task.laneId === laneId ? { ...task, boardPosition: positions.get(task.id) ?? task.boardPosition } : task)
      }));
    }
    return taskWrite(id, () => write(id, laneId, targetIndex), previous);
  }, [patchSnapshot, repository, taskWrite]);

  const moveTaskToPriority = useCallback((id: string, priority: TaskPriority | null) => {
    const write = repository.moveTaskToPriority ?? (() => missing('moveTaskToPriority'));
    return taskWrite(id, () => write(id, priority));
  }, [repository, taskWrite]);

  const moveTaskToDate = useCallback((id: string, dueDate: string | null) => {
    const write = repository.moveTaskToDate ?? (() => missing('moveTaskToDate'));
    return taskWrite(id, () => write(id, dueDate));
  }, [repository, taskWrite]);

  const setTaskViewMemberships = useCallback((id: string, views: TaskView[]) => {
    const write = repository.setTaskViewMemberships ?? (() => missing('setTaskViewMemberships'));
    return taskWrite(id, () => write(id, views));
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
    dismissOperationError: () => setOperationError(null),
    createTask,
    updateTask,
    deleteTask,
    setTaskCompleted,
    moveTaskToLane,
    moveTaskToPriority,
    moveTaskToDate,
    setTaskViewMemberships,
    setTaskViewLinking: (enabled) => snapshotWrite(() => (repository.setTaskViewLinking ?? (() => missing('setTaskViewLinking')))(enabled)),
    createLane: (draft) => reloadAfter(() => (repository.createTaskLane ?? (() => missing('createTaskLane')))(draft)),
    updateLane: (id, draft) => reloadAfter(() => (repository.updateTaskLane ?? (() => missing('updateTaskLane')))(id, draft)),
    deleteLane: (id, replacementLaneId = null) => snapshotWrite(() => (repository.deleteTaskLane ?? (() => missing('deleteTaskLane')))(id, replacementLaneId)).then(() => undefined),
    reorderLanes: (orderedIds) => reloadAfter(() => (repository.reorderTaskLanes ?? (() => missing('reorderTaskLanes')))(orderedIds)),
    setDefaultLane: (id) => snapshotWrite(() => (repository.setDefaultTaskLane ?? (() => missing('setDefaultTaskLane')))(id)).then(() => undefined),
    setCompletionLane: (id) => snapshotWrite(() => (repository.setCompletionTaskLane ?? (() => missing('setCompletionTaskLane')))(id)).then(() => undefined),
    createTag: (draft) => reloadAfter(() => (repository.createTaskTag ?? (() => missing('createTaskTag')))(draft)),
    updateTag: (id, draft) => reloadAfter(() => (repository.updateTaskTag ?? (() => missing('updateTaskTag')))(id, draft)),
    archiveTag: (id, archived) => reloadAfter(() => (repository.archiveTaskTag ?? (() => missing('archiveTaskTag')))(id, archived)),
    deleteTag: (id) => reloadAfter(() => (repository.deleteTaskTag ?? (() => missing('deleteTaskTag')))(id)),
    createCollaborator: (draft) => reloadAfter(() => (repository.createTaskCollaborator ?? (() => missing('createTaskCollaborator')))(draft)),
    updateCollaborator: (id, draft) => reloadAfter(() => (repository.updateTaskCollaborator ?? (() => missing('updateTaskCollaborator')))(id, draft)),
    archiveCollaborator: (id, archived) => reloadAfter(() => (repository.archiveTaskCollaborator ?? (() => missing('archiveTaskCollaborator')))(id, archived)),
    deleteCollaborator: (id) => reloadAfter(() => (repository.deleteTaskCollaborator ?? (() => missing('deleteTaskCollaborator')))(id)),
    setViewPreferences: (preferences) => snapshotWrite(() => (repository.setTaskViewPreferences ?? (() => missing('setTaskViewPreferences')))(preferences)).then(() => undefined)
  }), [
    workspace, pendingTaskIds, operationError, retry, createTask, updateTask, deleteTask,
    setTaskCompleted, moveTaskToLane, moveTaskToPriority, moveTaskToDate,
    setTaskViewMemberships, snapshotWrite, reloadAfter, repository
  ]);

  return <TaskWorkspaceContext.Provider value={value}>{children}</TaskWorkspaceContext.Provider>;
}

export function useTaskWorkspace() {
  const value = useContext(TaskWorkspaceContext);
  if (!value) throw new Error('useTaskWorkspace must be used inside TaskWorkspaceProvider');
  return value;
}

export function useOptionalTaskWorkspace() {
  return useContext(TaskWorkspaceContext);
}

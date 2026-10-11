import { useCallback, useMemo, useState } from 'react';
import { t } from '../i18n';
import type { MatrixTask, Quadrant, TaskDraft as MatrixTaskDraft } from '../matrix/matrix-model';
import { matrixDraftToWorkspace, matrixTasksFromWorkspace, taskToMatrixTask } from './task-projections';
import { useTaskWorkspace } from './TaskWorkspaceContext';

export function useWorkspaceTasks() {
  const workspace = useTaskWorkspace();
  const [failedCompletion, setFailedCompletion] = useState<{
    taskId: string;
    targetCompleted: boolean;
    message: string;
  } | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);

  const tasks = useMemo(() => ({
    status: workspace.workspace.status,
    data: matrixTasksFromWorkspace(workspace.workspace.data),
    ...(workspace.workspace.status === 'error' ? { message: workspace.workspace.message } : {})
  }), [workspace.workspace]);

  const createTask = useCallback(async (draft: MatrixTaskDraft) => {
    const saved = await workspace.createTask(
      'matrix',
      matrixDraftToWorkspace(draft, undefined, workspace.workspace.data)
    );
    const projected = taskToMatrixTask(saved, workspace.workspace.data.tags);
    if (!projected) throw new Error(t('taskWorkspace.createdNotVisible'));
    return projected;
  }, [workspace]);

  const updateTask = useCallback(async (task: MatrixTask, draft: MatrixTaskDraft) => {
    const current = workspace.workspace.data.tasks.find((item) => item.id === task.id);
    const saved = await workspace.updateTask(
      task.id,
      matrixDraftToWorkspace(draft, current, workspace.workspace.data)
    );
    const projected = taskToMatrixTask(saved, workspace.workspace.data.tags);
    if (!projected) throw new Error(t('taskWorkspace.updatedNotVisible'));
    return projected;
  }, [workspace]);

  const deleteTask = useCallback(async (task: MatrixTask) => {
    await workspace.deleteTask(task.id);
  }, [workspace]);

  const setTaskCompleted = useCallback(async (task: MatrixTask, completed: boolean) => {
    if (workspace.pendingTaskIds.has(task.id)) return;
    setFailedCompletion(null);
    try {
      await workspace.setTaskCompleted(task.id, completed);
    } catch (error) {
      setFailedCompletion({
        taskId: task.id,
        targetCompleted: completed,
        message: error instanceof Error ? error.message : t('taskWorkspace.completionFailed')
      });
    }
  }, [workspace]);

  const retryFailedCompletion = useCallback(async () => {
    if (!failedCompletion) return;
    const task = tasks.data.find((item) => item.id === failedCompletion.taskId);
    if (!task) {
      setFailedCompletion(null);
      return;
    }
    await setTaskCompleted(task, failedCompletion.targetCompleted);
  }, [failedCompletion, setTaskCompleted, tasks.data]);

  const moveTask = useCallback(async (task: MatrixTask, quadrant: Quadrant) => {
    setDragError(null);
    try {
      await workspace.moveTaskToPriority(task.id, quadrant);
    } catch (error) {
      setDragError(error instanceof Error ? error.message : t('taskWorkspace.moveFailed'));
    }
  }, [workspace]);

  return {
    tasks,
    retryTasks: workspace.retry,
    createTask,
    updateTask,
    deleteTask,
    setTaskCompleted,
    moveTask,
    retryFailedCompletion,
    dismissTaskError: () => setFailedCompletion(null),
    dismissDragError: () => setDragError(null),
    pendingTaskIds: workspace.pendingTaskIds,
    failedCompletion,
    dragError: dragError ?? workspace.operationError
  };
}

import { useCallback, useMemo, useState } from 'react';
import type { MatrixTask, Quadrant, TaskDraft as MatrixTaskDraft } from '../matrix/matrix-model';
import { matrixDraftToWorkspace, matrixTasksFromWorkspace, taskToMatrixTask } from './task-projections';
import { useTaskWorkspace } from './TaskWorkspaceContext';

export function useWorkspaceTasks({ onRefreshEvents }: { onRefreshEvents: () => Promise<unknown> }) {
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
    if (saved.linkedEventId) await onRefreshEvents();
    const projected = taskToMatrixTask(saved, workspace.workspace.data.tags);
    if (!projected) throw new Error('创建的任务没有四象限成员关系。');
    return projected;
  }, [onRefreshEvents, workspace]);

  const updateTask = useCallback(async (task: MatrixTask, draft: MatrixTaskDraft) => {
    const current = workspace.workspace.data.tasks.find((item) => item.id === task.id);
    const saved = await workspace.updateTask(
      task.id,
      matrixDraftToWorkspace(draft, current, workspace.workspace.data)
    );
    if (task.linkedEventId !== saved.linkedEventId) await onRefreshEvents();
    const projected = taskToMatrixTask(saved, workspace.workspace.data.tags);
    if (!projected) throw new Error('更新后的任务不再显示在四象限。');
    return projected;
  }, [onRefreshEvents, workspace]);

  const deleteTask = useCallback(async (task: MatrixTask) => {
    await workspace.deleteTask(task.id);
    if (task.linkedEventId) await onRefreshEvents();
  }, [onRefreshEvents, workspace]);

  const setTaskCompleted = useCallback(async (task: MatrixTask, completed: boolean) => {
    if (workspace.pendingTaskIds.has(task.id)) return;
    setFailedCompletion(null);
    try {
      await workspace.setTaskCompleted(task.id, completed);
    } catch (error) {
      setFailedCompletion({
        taskId: task.id,
        targetCompleted: completed,
        message: error instanceof Error ? error.message : '完成状态保存失败'
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
      setDragError(error instanceof Error ? error.message : '任务移动失败');
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

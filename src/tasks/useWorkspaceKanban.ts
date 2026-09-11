import { useCallback, useMemo, useState } from 'react';
import type { KanbanLaneDraft } from '../kanban/kanban-model';
import { useTaskWorkspace } from './TaskWorkspaceContext';
import { kanbanSnapshotFromWorkspace } from './task-projections';

// Projects the unified task workspace into the shape the board renders, and adds
// the drag-error handling the board needs on top of it. Card and field writes are
// not here: the task dialog and the task settings dialog both talk to the
// workspace directly.
export function useWorkspaceKanban() {
  const workspace = useTaskWorkspace();
  const [dragError, setDragError] = useState<string | null>(null);
  const data = useMemo(
    () => kanbanSnapshotFromWorkspace(workspace.workspace.data),
    [workspace.workspace.data]
  );
  const snapshot = workspace.workspace.status === 'error'
    ? { status: 'error' as const, data, message: workspace.workspace.message }
    : workspace.workspace.status === 'loading'
      ? { status: 'loading' as const, data }
      : { status: 'ready' as const, data };

  // Drag failures surface inline on the board instead of throwing, because the
  // gesture has already visually completed by the time the write is rejected.
  const moveCard = useCallback(async (id: string, laneId: string, targetIndex: number) => {
    setDragError(null);
    try {
      await workspace.moveTaskToLane(id, laneId, targetIndex);
    } catch (error) {
      setDragError(
        typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message
          : '移动任务失败，请重试。'
      );
    }
  }, [workspace]);

  const reorderLanes = useCallback(async (orderedIds: string[]) => {
    setDragError(null);
    try {
      await workspace.reorderLanes(orderedIds);
    } catch (error) {
      setDragError(
        typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message
          : '调整泳道顺序失败，请重试。'
      );
    }
  }, [workspace]);

  return {
    snapshot,
    dragError: dragError ?? workspace.operationError,
    retry: workspace.retry,
    dismissDragError: () => {
      setDragError(null);
      workspace.dismissOperationError();
    },
    createLane: (draft: KanbanLaneDraft) => workspace.createLane(draft),
    updateLane: (id: string, draft: KanbanLaneDraft) => workspace.updateLane(id, draft),
    deleteLane: (id: string) => {
      // Cards in a deleted lane move to the first survivor rather than being
      // orphaned, which would hide them from the board entirely.
      const fallback = workspace.workspace.data.lanes.find((lane) => lane.id !== id)?.id ?? null;
      return workspace.deleteLane(id, fallback);
    },
    reorderLanes,
    moveCard
  };
}

import { useCallback, useMemo, useState } from 'react';
import type {
  KanbanCardDraft,
  KanbanCollaboratorDraft,
  KanbanLaneDraft,
  KanbanPriorityDraft,
  KanbanTagDraft
} from '../kanban/kanban-model';
import { useTaskWorkspace } from './TaskWorkspaceContext';
import { kanbanSnapshotFromWorkspace, taskToKanbanCard } from './task-projections';
import type { TaskDraft } from './task-model';

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

  const taskDraft = useCallback((card: KanbanCardDraft): TaskDraft => {
    const current = workspace.workspace.data.tasks.find((task) => task.id === card.title);
    void current;
    return {
      title: card.title,
      description: card.description ?? '',
      priority: card.priorityId as TaskDraft['priority'],
      dueDate: card.dueDate,
      completed: card.laneId === workspace.workspace.data.completionLaneId,
      laneId: card.laneId,
      tagIds: card.tagIds,
      collaboratorIds: card.collaboratorIds,
      linkedEventId: null
    };
  }, [workspace.workspace.data.completionLaneId, workspace.workspace.data.tasks]);

  const createCard = useCallback(async (draft: KanbanCardDraft) => {
    const created = await workspace.createTask('kanban', taskDraft(draft));
    return taskToKanbanCard(created);
  }, [taskDraft, workspace]);

  const updateCard = useCallback(async (id: string, draft: KanbanCardDraft) => {
    const current = workspace.workspace.data.tasks.find((task) => task.id === id);
    const saved = await workspace.updateTask(id, {
      ...taskDraft(draft),
      linkedEventId: current?.linkedEventId ?? null,
      views: current?.views
    });
    return taskToKanbanCard(saved);
  }, [taskDraft, workspace]);

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
      const fallback = workspace.workspace.data.lanes.find((lane) => lane.id !== id)?.id ?? null;
      return workspace.deleteLane(id, fallback);
    },
    reorderLanes,
    createCard,
    updateCard,
    deleteCard: (id: string) => workspace.deleteTask(id),
    moveCard,
    // Fixed priorities are immutable. These methods reject if an old dialog
    // attempts to mutate them; the new field manager renders them read-only.
    createPriority: async (_draft: KanbanPriorityDraft) => { throw new Error('四象限优先分类不可新增。'); },
    updatePriority: async (_id: string, _draft: KanbanPriorityDraft) => { throw new Error('四象限优先分类不可修改。'); },
    deletePriority: async (_id: string) => { throw new Error('四象限优先分类不可删除。'); },
    reorderPriorities: async () => data.priorities,
    createTag: async (draft: KanbanTagDraft) => {
      await workspace.createTag(draft);
      return data.tags[0];
    },
    updateTag: async (id: string, draft: KanbanTagDraft) => {
      await workspace.updateTag(id, draft);
      return data.tags.find((tag) => tag.id === id)!;
    },
    deleteTag: (id: string) => workspace.deleteTag(id),
    createCollaborator: async (draft: KanbanCollaboratorDraft) => {
      await workspace.createCollaborator(draft);
      return data.collaborators[0];
    },
    updateCollaborator: async (id: string, draft: KanbanCollaboratorDraft) => {
      await workspace.updateCollaborator(id, draft);
      return data.collaborators.find((person) => person.id === id)!;
    },
    deleteCollaborator: (id: string) => workspace.deleteCollaborator(id)
  };
}

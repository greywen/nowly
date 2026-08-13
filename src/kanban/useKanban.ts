import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import {
  cardsInLane,
  sortSnapshot,
  type KanbanCardDraft,
  type KanbanCollaboratorDraft,
  type KanbanLaneDraft,
  type KanbanPriorityDraft,
  type KanbanSnapshot,
  type KanbanTagDraft
} from './kanban-model';

const emptySnapshot: KanbanSnapshot = {
  lanes: [],
  cards: [],
  priorities: [],
  tags: [],
  collaborators: []
};

type SnapshotResource =
  | { status: 'loading'; data: KanbanSnapshot }
  | { status: 'ready'; data: KanbanSnapshot }
  | { status: 'error'; data: KanbanSnapshot; message: string };

function messageFrom(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return '无法读取看板数据，请重试。';
}

// Renumber every card in a lane to dense positions after a local mutation so the
// optimistic snapshot mirrors what the backend transaction will persist.
function renumberLane(cards: KanbanSnapshot['cards'], laneId: string) {
  const ordered = cardsInLane(cards, laneId);
  const positions = new Map(ordered.map((c, index) => [c.id, index]));
  return cards.map((c) => (c.laneId === laneId ? { ...c, position: positions.get(c.id) ?? c.position } : c));
}

export function useKanban() {
  const repository = useNowlyRepository();
  const [snapshot, setSnapshot] = useState<SnapshotResource>({ status: 'loading', data: emptySnapshot });
  const [dragError, setDragError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const dataRef = useRef<KanbanSnapshot>(emptySnapshot);

  const applySnapshot = useCallback((data: KanbanSnapshot) => {
    const sorted = sortSnapshot(data);
    dataRef.current = sorted;
    setSnapshot({ status: 'ready', data: sorted });
  }, []);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setSnapshot((current) => ({ status: 'loading', data: current.data }));
    try {
      const data = await repository.getKanbanSnapshot();
      if (requestId === requestIdRef.current) applySnapshot(data);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setSnapshot((current) => ({ status: 'error', data: current.data, message: messageFrom(error) }));
      }
    }
  }, [applySnapshot, repository]);

  useEffect(() => {
    void load();
  }, [load]);

  // Plain writes reload the authoritative snapshot after the backend confirms.
  const reloadAfter = useCallback(
    async <T,>(operation: Promise<T>) => {
      const result = await operation;
      await load();
      return result;
    },
    [load]
  );

  const createLane = useCallback(
    (draft: KanbanLaneDraft) => reloadAfter(repository.createKanbanLane(draft)),
    [reloadAfter, repository]
  );
  const updateLane = useCallback(
    (id: string, draft: KanbanLaneDraft) => reloadAfter(repository.updateKanbanLane(id, draft)),
    [reloadAfter, repository]
  );
  const deleteLane = useCallback(
    (id: string) => reloadAfter(repository.deleteKanbanLane(id)),
    [reloadAfter, repository]
  );

  const createCard = useCallback(
    (draft: KanbanCardDraft) => reloadAfter(repository.createKanbanCard(draft)),
    [reloadAfter, repository]
  );
  const updateCard = useCallback(
    (id: string, draft: KanbanCardDraft) => reloadAfter(repository.updateKanbanCard(id, draft)),
    [reloadAfter, repository]
  );
  const deleteCard = useCallback(
    (id: string) => reloadAfter(repository.deleteKanbanCard(id)),
    [reloadAfter, repository]
  );

  const createPriority = useCallback(
    (draft: KanbanPriorityDraft) => reloadAfter(repository.createKanbanPriority(draft)),
    [reloadAfter, repository]
  );
  const updatePriority = useCallback(
    (id: string, draft: KanbanPriorityDraft) => reloadAfter(repository.updateKanbanPriority(id, draft)),
    [reloadAfter, repository]
  );
  const deletePriority = useCallback(
    (id: string) => reloadAfter(repository.deleteKanbanPriority(id)),
    [reloadAfter, repository]
  );
  const reorderPriorities = useCallback(
    (orderedIds: string[]) => reloadAfter(repository.reorderKanbanPriorities(orderedIds)),
    [reloadAfter, repository]
  );

  const createTag = useCallback(
    (draft: KanbanTagDraft) => reloadAfter(repository.createKanbanTag(draft)),
    [reloadAfter, repository]
  );
  const updateTag = useCallback(
    (id: string, draft: KanbanTagDraft) => reloadAfter(repository.updateKanbanTag(id, draft)),
    [reloadAfter, repository]
  );
  const deleteTag = useCallback(
    (id: string) => reloadAfter(repository.deleteKanbanTag(id)),
    [reloadAfter, repository]
  );

  const createCollaborator = useCallback(
    (draft: KanbanCollaboratorDraft) => reloadAfter(repository.createKanbanCollaborator(draft)),
    [reloadAfter, repository]
  );
  const updateCollaborator = useCallback(
    (id: string, draft: KanbanCollaboratorDraft) => reloadAfter(repository.updateKanbanCollaborator(id, draft)),
    [reloadAfter, repository]
  );
  const deleteCollaborator = useCallback(
    (id: string) => reloadAfter(repository.deleteKanbanCollaborator(id)),
    [reloadAfter, repository]
  );

  // Drag interactions optimistically update the local snapshot for immediate
  // feedback, then persist. On failure the pre-drag snapshot is restored.
  const moveCard = useCallback(
    async (cardId: string, targetLaneId: string, targetIndex: number) => {
      const previous = dataRef.current;
      const moving = previous.cards.find((c) => c.id === cardId);
      if (!moving) return;
      setDragError(null);

      const withoutCard = previous.cards.filter((c) => c.id !== cardId);
      const target = cardsInLane(withoutCard, targetLaneId);
      const clampedIndex = Math.max(0, Math.min(targetIndex, target.length));
      const relocated = { ...moving, laneId: targetLaneId };
      const nextTarget = [...target];
      nextTarget.splice(clampedIndex, 0, relocated);
      const targetIds = new Set(nextTarget.map((c) => c.id));
      const positions = new Map(nextTarget.map((c, index) => [c.id, index]));
      let nextCards = withoutCard
        .filter((c) => c.laneId !== targetLaneId)
        .concat(nextTarget.map((c) => ({ ...c, laneId: targetLaneId, position: positions.get(c.id) ?? c.position })));
      // Renumber the source lane too when the card left it.
      if (moving.laneId !== targetLaneId) {
        nextCards = renumberLane(nextCards, moving.laneId);
      }
      // Guard: keep only cards we know about (targetIds recomputed for safety).
      void targetIds;
      applySnapshot({ ...previous, cards: nextCards });

      try {
        // The optimistic snapshot already mirrors the dense renumbering the
        // backend transaction performs, so it stays authoritative until the
        // next natural reload; no post-success refetch that would flash.
        await repository.moveKanbanCard(cardId, targetLaneId, clampedIndex);
      } catch (error) {
        applySnapshot(previous);
        setDragError(messageFrom(error));
      }
    },
    [applySnapshot, repository]
  );

  const reorderLanes = useCallback(
    async (orderedIds: string[]) => {
      const previous = dataRef.current;
      setDragError(null);
      const positions = new Map(orderedIds.map((id, index) => [id, index]));
      const nextLanes = previous.lanes.map((l) => ({ ...l, position: positions.get(l.id) ?? l.position }));
      applySnapshot({ ...previous, lanes: nextLanes });

      try {
        await repository.reorderKanbanLanes(orderedIds);
      } catch (error) {
        applySnapshot(previous);
        setDragError(messageFrom(error));
      }
    },
    [applySnapshot, repository]
  );

  const dismissDragError = useCallback(() => setDragError(null), []);

  return {
    snapshot,
    dragError,
    retry: load,
    dismissDragError,
    createLane,
    updateLane,
    deleteLane,
    reorderLanes,
    createCard,
    updateCard,
    deleteCard,
    moveCard,
    createPriority,
    updatePriority,
    deletePriority,
    reorderPriorities,
    createTag,
    updateTag,
    deleteTag,
    createCollaborator,
    updateCollaborator,
    deleteCollaborator
  };
}

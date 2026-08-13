import { Plus } from 'lucide-react';
import { type DragEvent, useRef, useState } from 'react';
import { cardsInLane, type KanbanCard as KanbanCardModel } from './kanban-model';
import {
  adjacentLaneId,
  cardIndexInLane,
  laneCardCount,
  laneOrderAfterMove,
  totalCardCount
} from './kanban-view';
import { KanbanLane } from './KanbanLane';
import { KanbanMenu } from './KanbanMenu';
import { KanbanLaneDialog } from './KanbanLaneDialog';
import { KanbanTaskDialog } from './KanbanTaskDialog';
import { KanbanFieldManagerDialog } from './KanbanFieldManagerDialog';
import { useKanban } from './useKanban';

// Drag payloads carried in component state (dataTransfer is unreliable in the
// WebView for structured data, and we keep everything static per the design).
type Drag =
  | { kind: 'card'; cardId: string }
  | { kind: 'lane'; laneId: string }
  | null;

type DialogState =
  | { type: 'lane-create' }
  | { type: 'lane-edit'; laneId: string }
  | { type: 'card-create'; laneId: string }
  | { type: 'card-edit'; cardId: string }
  | { type: 'fields' }
  | null;

export function KanbanWidget({ todayIso, recentColors = [], onRememberCustomColor }: { todayIso: string; recentColors?: string[]; onRememberCustomColor?: (color: string) => Promise<void> | void }) {
  const kanban = useKanban();
  const { snapshot, dragError } = kanban;
  const data = snapshot.data;
  const [dialog, setDialog] = useState<DialogState>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [dropLaneId, setDropLaneId] = useState<string | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const status = snapshot.status;
  const errorMessage = status === 'error' ? snapshot.message : undefined;

  function rememberTrigger(event: { currentTarget: HTMLElement }) {
    restoreFocusRef.current = event.currentTarget;
  }

  // ----- keyboard / menu moves ------------------------------------------------
  function moveCardWithinOrAcross(cardId: string, laneId: string, targetIndex: number) {
    void kanban.moveCard(cardId, laneId, targetIndex);
  }

  function cardById(cardId: string): KanbanCardModel | undefined {
    return data.cards.find((card) => card.id === cardId);
  }

  function moveCardUp(cardId: string) {
    const card = cardById(cardId);
    if (!card) return;
    const index = cardIndexInLane(data, card);
    if (index > 0) moveCardWithinOrAcross(cardId, card.laneId, index - 1);
  }

  function moveCardDown(cardId: string) {
    const card = cardById(cardId);
    if (!card) return;
    const index = cardIndexInLane(data, card);
    if (index < cardsInLane(data.cards, card.laneId).length - 1) {
      moveCardWithinOrAcross(cardId, card.laneId, index + 1);
    }
  }

  function moveCardToLane(cardId: string, delta: number) {
    const card = cardById(cardId);
    if (!card) return;
    const target = adjacentLaneId(data.lanes, card.laneId, delta);
    if (target) moveCardWithinOrAcross(cardId, target, cardsInLane(data.cards, target).length);
  }

  function moveLane(laneId: string, delta: number) {
    const next = laneOrderAfterMove(data, laneId, delta);
    if (next) void kanban.reorderLanes(next);
  }

  // ----- drag and drop --------------------------------------------------------
  function onCardDragStart(event: DragEvent<HTMLElement>, cardId: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', cardId);
    setDrag({ kind: 'card', cardId });
  }

  function onLaneDragStart(event: DragEvent<HTMLElement>, laneId: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', laneId);
    setDrag({ kind: 'lane', laneId });
  }

  function onDragEnd() {
    setDrag(null);
    setDropLaneId(null);
  }

  function onLaneDragOver(event: DragEvent<HTMLElement>, laneId: string) {
    if (!drag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (drag.kind === 'card') setDropLaneId(laneId);
  }

  function onCardDropInLane(laneId: string, index: number) {
    if (drag?.kind !== 'card') return;
    moveCardWithinOrAcross(drag.cardId, laneId, index);
    onDragEnd();
  }

  function onLaneDropReorder(targetLaneId: string) {
    if (drag?.kind !== 'lane') return;
    const sourceIndex = data.lanes.findIndex((lane) => lane.id === drag.laneId);
    const targetIndex = data.lanes.findIndex((lane) => lane.id === targetLaneId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
      onDragEnd();
      return;
    }
    const order = data.lanes.map((lane) => lane.id);
    const [removed] = order.splice(sourceIndex, 1);
    order.splice(targetIndex, 0, removed);
    void kanban.reorderLanes(order);
    onDragEnd();
  }

  const boardMenuItems = [{ label: '管理字段', onSelect: () => setDialog({ type: 'fields' }) }];

  // ----- dialog resolution ----------------------------------------------------
  const editingLane =
    dialog?.type === 'lane-edit' ? data.lanes.find((lane) => lane.id === dialog.laneId) ?? null : null;
  const creatingCardLane =
    dialog?.type === 'card-create' ? data.lanes.find((lane) => lane.id === dialog.laneId) ?? null : null;
  const editingCard =
    dialog?.type === 'card-edit' ? data.cards.find((card) => card.id === dialog.cardId) ?? null : null;

  function closeDialog() {
    setDialog(null);
  }

  return (
    <div className="widget-content kanban-widget">
      <div className="card-header">
        <div className="heading-group">
          <h2>看板</h2>
          <p>{`${totalCardCount(data)} 张任务`}</p>
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn btn-primary"
            aria-label="添加泳道"
            onClick={(event) => {
              rememberTrigger(event);
              setDialog({ type: 'lane-create' });
            }}
          >
            <Plus aria-hidden="true" />
            添加泳道
          </button>
          <KanbanMenu label="看板更多操作" items={boardMenuItems} />
        </div>
      </div>

      <div className="panel-body kanban-body">
        {status === 'error' ? (
          <div className="module-message" role="alert">
            <span>{errorMessage ?? '无法读取看板数据。'}</span>
            <button type="button" className="link-btn" aria-label="重试读取看板" onClick={() => void kanban.retry()}>
              重试
            </button>
          </div>
        ) : null}
        {dragError ? (
          <div className="module-message" role="alert">
            <span>{dragError}</span>
            <button type="button" className="link-btn" aria-label="关闭拖放错误" onClick={kanban.dismissDragError}>
              关闭
            </button>
          </div>
        ) : null}
        {status === 'loading' ? <p className="empty-copy">正在读取看板数据</p> : null}

        {status !== 'loading' && data.lanes.length === 0 ? (
          <div className="empty-state">
            <p>还没有泳道，先添加一个泳道开始使用看板。</p>
          </div>
        ) : (
          <div className="kanban-scroll" data-testid="kanban-scroll">
            <div className="kanban-lanes">
              {data.lanes.map((lane, index) => (
                <KanbanLane
                  key={lane.id}
                  lane={lane}
                  snapshot={data}
                  todayIso={todayIso}
                  canMoveLaneLeft={index > 0}
                  canMoveLaneRight={index < data.lanes.length - 1}
                  isDropTarget={drag?.kind === 'card' && dropLaneId === lane.id}
                  onAddCard={() => setDialog({ type: 'card-create', laneId: lane.id })}
                  onEditLane={() => setDialog({ type: 'lane-edit', laneId: lane.id })}
                  onMoveLaneLeft={() => moveLane(lane.id, -1)}
                  onMoveLaneRight={() => moveLane(lane.id, 1)}
                  onOpenCard={(cardId) => setDialog({ type: 'card-edit', cardId })}
                  onMoveCardUp={moveCardUp}
                  onMoveCardDown={moveCardDown}
                  onMoveCardLeft={(cardId) => moveCardToLane(cardId, -1)}
                  onMoveCardRight={(cardId) => moveCardToLane(cardId, 1)}
                  onDeleteCard={(cardId) => void kanban.deleteCard(cardId)}
                  onLaneDragStart={(event) => onLaneDragStart(event, lane.id)}
                  onLaneDragEnd={onDragEnd}
                  onLaneDragOver={(event) => {
                    onLaneDragOver(event, lane.id);
                    if (drag?.kind === 'lane') event.preventDefault();
                  }}
                  onLaneDrop={(event, cardIndex) => {
                    event.preventDefault();
                    if (drag?.kind === 'lane') onLaneDropReorder(lane.id);
                    else onCardDropInLane(lane.id, cardIndex);
                  }}
                  onCardDragStart={onCardDragStart}
                  onCardDragEnd={onDragEnd}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {dialog?.type === 'lane-create' ? (
        <KanbanLaneDialog
          mode={{ type: 'create' }}
          restoreFocusRef={restoreFocusRef}
          onClose={closeDialog}
          onCreate={kanban.createLane}
          onUpdate={(lane, draft) => kanban.updateLane(lane.id, draft)}
          onDelete={(lane) => kanban.deleteLane(lane.id)}
        />
      ) : null}
      {dialog?.type === 'lane-edit' && editingLane ? (
        <KanbanLaneDialog
          mode={{ type: 'edit', lane: editingLane, cardCount: laneCardCount(data, editingLane.id) }}
          restoreFocusRef={restoreFocusRef}
          onClose={closeDialog}
          onCreate={kanban.createLane}
          onUpdate={(lane, draft) => kanban.updateLane(lane.id, draft)}
          onDelete={(lane) => kanban.deleteLane(lane.id)}
        />
      ) : null}
      {dialog?.type === 'card-create' && creatingCardLane ? (
        <KanbanTaskDialog
          mode={{ type: 'create', laneId: creatingCardLane.id, laneName: creatingCardLane.name }}
          priorities={data.priorities}
          tags={data.tags}
          collaborators={data.collaborators}
          restoreFocusRef={restoreFocusRef}
          onClose={closeDialog}
          createCard={kanban.createCard}
          updateCard={kanban.updateCard}
          deleteCard={kanban.deleteCard}
        />
      ) : null}
      {dialog?.type === 'card-edit' && editingCard ? (
        <KanbanTaskDialog
          mode={{ type: 'edit', card: editingCard }}
          priorities={data.priorities}
          tags={data.tags}
          collaborators={data.collaborators}
          restoreFocusRef={restoreFocusRef}
          onClose={closeDialog}
          createCard={kanban.createCard}
          updateCard={kanban.updateCard}
          deleteCard={kanban.deleteCard}
        />
      ) : null}
      {dialog?.type === 'fields' ? (
        <KanbanFieldManagerDialog
          snapshot={data}
          restoreFocusRef={restoreFocusRef}
          onClose={closeDialog}
          createPriority={kanban.createPriority}
          updatePriority={kanban.updatePriority}
          deletePriority={kanban.deletePriority}
          reorderPriorities={kanban.reorderPriorities}
          createTag={kanban.createTag}
          updateTag={kanban.updateTag}
          deleteTag={kanban.deleteTag}
          createCollaborator={kanban.createCollaborator}
          updateCollaborator={kanban.updateCollaborator}
          deleteCollaborator={kanban.deleteCollaborator}
        />
      ) : null}
    </div>
  );
}

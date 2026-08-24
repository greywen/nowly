import { Plus, Settings } from 'lucide-react';
import { type DragEvent, useRef, useState } from 'react';
import { laneCardCount, totalCardCount } from './kanban-view';
import { KanbanLane } from './KanbanLane';
import { KanbanLaneDialog } from './KanbanLaneDialog';
import { KanbanTaskDialog } from './KanbanTaskDialog';
import { KanbanFieldManagerDialog } from './KanbanFieldManagerDialog';
import { useKanban } from './useKanban';
import { t } from '../i18n';

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

  // ----- card moves -----------------------------------------------------------
  function moveCardWithinOrAcross(cardId: string, laneId: string, targetIndex: number) {
    void kanban.moveCard(cardId, laneId, targetIndex);
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
          <p>{t('kanbanWidget.cardCount', { count: totalCardCount(data) })}</p>
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn btn-icon"
            aria-label={t('kanbanWidget.boardMenu')}
            onClick={(event) => {
              rememberTrigger(event);
              setDialog({ type: 'fields' });
            }}
          >
            <Settings aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-primary"
            aria-label={t('kanbanWidget.addLane')}
            onClick={(event) => {
              rememberTrigger(event);
              setDialog({ type: 'lane-create' });
            }}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="panel-body kanban-body">
        {status === 'error' ? (
          <div className="module-message" role="alert">
            <span>{errorMessage ?? t('kanbanWidget.errorLoad')}</span>
            <button type="button" className="link-btn" aria-label={t('kanbanWidget.retryLoad')} onClick={() => void kanban.retry()}>
              {t('common.retry')}
            </button>
          </div>
        ) : null}
        {dragError ? (
          <div className="module-message" role="alert">
            <span>{dragError}</span>
            <button type="button" className="link-btn" aria-label={t('kanbanWidget.dismissDragError')} onClick={kanban.dismissDragError}>
              {t('common.close')}
            </button>
          </div>
        ) : null}
        {status === 'loading' ? <p className="empty-copy">{t('kanbanWidget.loading')}</p> : null}

        {status !== 'loading' && data.lanes.length === 0 ? (
          <div className="empty-state">
            <p>{t('kanbanWidget.empty')}</p>
          </div>
        ) : (
          <div className="kanban-scroll" data-testid="kanban-scroll">
            <div className="kanban-lanes">
              {data.lanes.map((lane) => (
                <KanbanLane
                  key={lane.id}
                  lane={lane}
                  snapshot={data}
                  todayIso={todayIso}
                  isDropTarget={drag?.kind === 'card' && dropLaneId === lane.id}
                  onAddCard={() => setDialog({ type: 'card-create', laneId: lane.id })}
                  onEditLane={() => setDialog({ type: 'lane-edit', laneId: lane.id })}
                  onOpenCard={(cardId) => setDialog({ type: 'card-edit', cardId })}
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
          recentColors={recentColors}
          onRememberCustomColor={onRememberCustomColor}
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
          recentColors={recentColors}
          onRememberCustomColor={onRememberCustomColor}
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
          recentColors={recentColors}
          onRememberCustomColor={onRememberCustomColor}
        />
      ) : null}
    </div>
  );
}

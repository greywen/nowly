import { colorStyle } from '../lib/color';
import type { DragEvent } from 'react';
import { cardsInLane, type KanbanCard as KanbanCardModel, type KanbanLane as KanbanLaneModel, type KanbanSnapshot } from './kanban-model';
import { resolveCard } from './kanban-view';
import { KanbanCard } from './KanbanCard';
import { ActionMenu } from '../components/ActionMenu';
import { InlineTaskAdd } from '../tasks/InlineTaskAdd';
import { t } from '../i18n';

type KanbanLaneProps = {
  lane: KanbanLaneModel;
  snapshot: KanbanSnapshot;
  todayIso: string;
  isDropTarget: boolean;
  // The task being dragged onto the board (a card or a matrix task), if any.
  draggingTaskId: string | null;
  // Where the insertion line shows, counted among the visible cards other than
  // the dragged one. Null hides it.
  dropIndex: number | null;
  onAddTask: (title: string) => Promise<unknown>;
  onEditLane: (trigger: HTMLElement | null) => void;
  onAddLaneRight: (trigger: HTMLElement | null) => void;
  onDeleteLane: (trigger: HTMLElement | null) => void;
  onOpenCard: (cardId: string, trigger: HTMLElement) => void;
  onLaneDragStart: (event: DragEvent<HTMLElement>) => void;
  onLaneDragEnd: () => void;
  // `visibleIndex` positions the insertion line; `index` is the lane position
  // to write, counted among the lane's open cards without the dragged one.
  onLaneDragOver: (event: DragEvent<HTMLElement>, visibleIndex: number) => void;
  onLaneDrop: (event: DragEvent<HTMLElement>, index: number) => void;
  onCardDragStart: (event: DragEvent<HTMLElement>, cardId: string) => void;
  onCardDragEnd: () => void;
  // Optional predicate deciding which cards are visible under the active board
  // filter. Defaults to showing everything.
  matchesFilter?: (card: KanbanCardModel) => boolean;
};

// The slot the pointer is above, by comparing it to each slot's midpoint.
function pointerIndex(lane: HTMLElement, clientY: number): number {
  const slots = [...lane.querySelectorAll<HTMLElement>('[data-drop-slot]')];
  const index = slots.findIndex((slot) => {
    const rect = slot.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  return index < 0 ? slots.length : index;
}

// One fluid lane that shares board width: a draggable header with colour, name,
// card count and a "⋯" menu for lane commands, the card list, and an inline
// "add task" row at the end. The lane is also a drop target for tasks.
export function KanbanLane({
  lane,
  snapshot,
  todayIso,
  isDropTarget,
  draggingTaskId,
  dropIndex,
  onAddTask,
  onEditLane,
  onAddLaneRight,
  onDeleteLane,
  onOpenCard,
  onLaneDragStart,
  onLaneDragEnd,
  onLaneDragOver,
  onLaneDrop,
  onCardDragStart,
  onCardDragEnd,
  matchesFilter
}: KanbanLaneProps) {
  const laneCards = cardsInLane(snapshot.cards, lane.id);
  const visibleCards = matchesFilter ? laneCards.filter(matchesFilter) : laneCards;
  // Drop positions skip the dragged card so a same-lane move lands where the
  // line shows; the backend counts the same way.
  const others = laneCards.filter((card) => card.id !== draggingTaskId);
  const targets = visibleCards.filter((card) => card.id !== draggingTaskId);

  function laneIndex(visibleIndex: number): number {
    if (visibleIndex < targets.length) return others.findIndex((card) => card.id === targets[visibleIndex].id);
    const last = targets[targets.length - 1];
    return last ? others.findIndex((card) => card.id === last.id) + 1 : others.length;
  }

  const dropLine = <div className="kanban-drop-line" aria-hidden="true" data-testid="kanban-drop-line" />;

  return (
    <section
      className={`kanban-lane${isDropTarget ? ' kanban-lane--drop' : ''}`}
      aria-label={t('kanbanLane.lane', { name: lane.name })}
      onDragOver={(event) => onLaneDragOver(event, pointerIndex(event.currentTarget, event.clientY))}
      onDrop={(event) => onLaneDrop(event, laneIndex(pointerIndex(event.currentTarget, event.clientY)))}
    >
      <header
        className="kanban-lane__head"
        style={colorStyle(lane.color)}
        draggable
        onDragStart={onLaneDragStart}
        onDragEnd={onLaneDragEnd}
      >
        <span className="kanban-lane__dot" style={colorStyle(lane.color)} aria-hidden="true" />
        <h3 className="kanban-lane__name">{lane.name}</h3>
        <span className="kanban-lane__count" aria-label={t('kanbanLane.count', { name: lane.name, count: visibleCards.length })}>
          {visibleCards.length}
        </span>
        <div className="kanban-lane__actions">
          <ActionMenu
            label={t('kanbanLane.menu', { name: lane.name })}
            items={[
              { id: 'edit', label: t('kanbanLane.edit'), onSelect: onEditLane },
              { id: 'add-right', label: t('kanbanLane.addRight'), onSelect: onAddLaneRight },
              { id: 'delete', label: t('kanbanLane.delete'), tone: 'danger' as const, onSelect: onDeleteLane }
            ]}
          />
        </div>
      </header>

      <div className="kanban-lane__cards" data-testid="kanban-lane-cards">
        {visibleCards.map((card) => {
          const dragging = card.id === draggingTaskId;
          const targetIndex = dragging ? -1 : targets.indexOf(card);
          return (
            <div key={card.id} className="kanban-card-slot" data-drop-slot={dragging ? undefined : ''}>
              {targetIndex >= 0 && targetIndex === dropIndex ? dropLine : null}
              <KanbanCard
                resolved={resolveCard(card, snapshot)}
                todayIso={todayIso}
                dragging={dragging}
                onOpen={() => onOpenCard(card.id, document.activeElement as HTMLElement)}
                onDragStart={(event) => onCardDragStart(event, card.id)}
                onDragEnd={onCardDragEnd}
              />
            </div>
          );
        })}
        {dropIndex !== null && dropIndex >= targets.length ? dropLine : null}
        <InlineTaskAdd label={t('kanbanLane.addTask', { name: lane.name })} onCreate={onAddTask} />
      </div>
    </section>
  );
}
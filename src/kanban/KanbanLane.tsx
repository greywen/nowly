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
  isCompletionLane: boolean;
  onAddTask: (title: string) => Promise<unknown>;
  onEditLane: (trigger: HTMLElement | null) => void;
  onAddLaneRight: (trigger: HTMLElement | null) => void;
  // Omitted for the last lane, which the backend refuses to delete.
  onDeleteLane?: (trigger: HTMLElement | null) => void;
  onOpenCard: (cardId: string, trigger: HTMLElement) => void;
  onLaneDragStart: (event: DragEvent<HTMLElement>) => void;
  onLaneDragEnd: () => void;
  onLaneDragOver: (event: DragEvent<HTMLElement>) => void;
  onLaneDrop: (event: DragEvent<HTMLElement>, index: number) => void;
  onCardDragStart: (event: DragEvent<HTMLElement>, cardId: string) => void;
  onCardDragEnd: () => void;
  // Optional predicate deciding which cards are visible under the active board
  // filter. Defaults to showing everything.
  matchesFilter?: (card: KanbanCardModel) => boolean;
};

// One fluid lane that shares board width: a draggable header with colour, name,
// card count and a "⋯" menu for lane commands, the card list, and an inline
// "add task" row at the end. The lane is also a drop target for cards.
export function KanbanLane({
  lane,
  snapshot,
  todayIso,
  isDropTarget,
  isCompletionLane,
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

  return (
    <section
      className={`kanban-lane${isDropTarget ? ' kanban-lane--drop' : ''}`}
      aria-label={t('kanbanLane.lane', { name: lane.name })}
      onDragOver={onLaneDragOver}
      onDrop={(event) => onLaneDrop(event, laneCards.length)}
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
              ...(onDeleteLane
                ? [{ id: 'delete', label: t('kanbanLane.delete'), tone: 'danger' as const, onSelect: onDeleteLane }]
                : [])
            ]}
          />
        </div>
      </header>

      <div className="kanban-lane__cards" data-testid="kanban-lane-cards">
        {visibleCards.map((card) => {
          // Map the visible position back to the card's real index within the
          // full lane so drops land correctly even while a filter is active.
          const realIndex = laneCards.findIndex((item) => item.id === card.id);
          return (
            <div
              key={card.id}
              className="kanban-card-slot"
              onDragOver={onLaneDragOver}
              onDrop={(event) => {
                event.stopPropagation();
                onLaneDrop(event, realIndex);
              }}
            >
              <KanbanCard
                resolved={resolveCard(card, snapshot)}
                todayIso={todayIso}
                done={isCompletionLane}
                onOpen={() => onOpenCard(card.id, document.activeElement as HTMLElement)}
                onDragStart={(event) => onCardDragStart(event, card.id)}
                onDragEnd={onCardDragEnd}
              />
            </div>
          );
        })}
        <InlineTaskAdd label={t('kanbanLane.addTask', { name: lane.name })} onCreate={onAddTask} />
      </div>
    </section>
  );
}
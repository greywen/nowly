import { Plus } from 'lucide-react';
import { colorStyle } from '../lib/color';
import type { DragEvent } from 'react';
import { cardsInLane, type KanbanLane as KanbanLaneModel, type KanbanSnapshot } from './kanban-model';
import { resolveCard } from './kanban-view';
import { KanbanCard } from './KanbanCard';
import { t } from '../i18n';

type KanbanLaneProps = {
  lane: KanbanLaneModel;
  snapshot: KanbanSnapshot;
  todayIso: string;
  isDropTarget: boolean;
  onAddCard: () => void;
  onEditLane: () => void;
  onOpenCard: (cardId: string) => void;
  onLaneDragStart: (event: DragEvent<HTMLElement>) => void;
  onLaneDragEnd: () => void;
  onLaneDragOver: (event: DragEvent<HTMLElement>) => void;
  onLaneDrop: (event: DragEvent<HTMLElement>, index: number) => void;
  onCardDragStart: (event: DragEvent<HTMLElement>, cardId: string) => void;
  onCardDragEnd: () => void;
};

// One fluid lane that shares board width: a draggable header carrying colour, an editable name
// button and a card count, an add-card button, and the vertical list of task
// cards. The lane is also a drop target for cards.
export function KanbanLane({
  lane,
  snapshot,
  todayIso,
  isDropTarget,
  onAddCard,
  onEditLane,
  onOpenCard,
  onLaneDragStart,
  onLaneDragEnd,
  onLaneDragOver,
  onLaneDrop,
  onCardDragStart,
  onCardDragEnd
}: KanbanLaneProps) {
  const laneCards = cardsInLane(snapshot.cards, lane.id);

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
        <button type="button" className="kanban-lane__name" onClick={onEditLane}>
          {lane.name}
        </button>
        <span className="kanban-lane__count" aria-label={t('kanbanLane.count', { name: lane.name, count: laneCards.length })}>
          {laneCards.length}
        </span>
        <div className="kanban-lane__actions">
          <button
            type="button"
            className="good-icon-button"
            aria-label={t('kanbanLane.addTask', { name: lane.name })}
            onClick={onAddCard}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="kanban-lane__cards" data-testid="kanban-lane-cards">
        {laneCards.length === 0 ? <p className="kanban-lane__empty">{t('kanbanLane.empty')}</p> : null}
        {laneCards.map((card, index) => {
          return (
            <div
              key={card.id}
              className="kanban-card-slot"
              onDragOver={onLaneDragOver}
              onDrop={(event) => {
                event.stopPropagation();
                onLaneDrop(event, index);
              }}
            >
              <KanbanCard
                resolved={resolveCard(card, snapshot)}
                todayIso={todayIso}
                onOpen={() => onOpenCard(card.id)}
                onDragStart={(event) => onCardDragStart(event, card.id)}
                onDragEnd={onCardDragEnd}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

import { CalendarDays } from 'lucide-react';
import { colorStyle } from '../lib/color';
import type { DragEvent } from 'react';
import type { ResolvedCard } from './kanban-view';
import { formatDueDate } from './kanban-view';

type KanbanCardProps = {
  resolved: ResolvedCard;
  todayIso: string;
  onOpen: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
};

// How many collaborator avatars render before collapsing the rest into "+N".
const MAX_AVATARS = 3;

// First character of a name, used as the avatar initial. Works for both CJK
// and Latin names since we only ever surface a single glyph.
function initial(name: string): string {
  return name.trim().slice(0, 1) || '?';
}

// A single task card laid out in three bands: a top row with the due date on
// the left and priority / actions on the right, the title in the middle, and a
// footer with collaborator avatars on the left and tags on the right. Optional
// fields render only when present, so empty cards stay compact. The card body
// drags; the title button opens the editor.
export function KanbanCard({
  resolved,
  todayIso,
  onOpen,
  onDragStart,
  onDragEnd
}: KanbanCardProps) {
  const { card, priority, tags, collaborators } = resolved;

  const visibleCollaborators = collaborators.slice(0, MAX_AVATARS);
  const overflowCount = collaborators.length - visibleCollaborators.length;
  const hasFooter = collaborators.length > 0 || tags.length > 0;
  const hasTop = Boolean(card.dueDate) || Boolean(priority);

  return (
    <article
      className={`kanban-card${hasTop ? '' : ' kanban-card--no-top'}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-label={`任务：${card.title}`}
    >
      {hasTop ? (
        <div className="kanban-card__top">
          {card.dueDate ? (
            <span className="kanban-card__date">
              <CalendarDays aria-hidden="true" />
              {formatDueDate(card.dueDate, todayIso)}
            </span>
          ) : (
            <span className="kanban-card__date kanban-card__date--empty" aria-hidden="true" />
          )}
          <div className="kanban-card__top-right">
            {priority ? (
              <span className="kanban-badge" style={colorStyle(priority.color)}>
                {priority.name}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <button type="button" className="kanban-card__title" onClick={onOpen}>
        {card.title}
      </button>

      {hasFooter ? (
        <div className="kanban-card__footer">
          {collaborators.length > 0 ? (
            <span
              className="kanban-card__people"
              aria-label={`协作人：${collaborators.map((person) => person.name).join('、')}`}
            >
              {visibleCollaborators.map((person) => (
                <span key={person.id} className="kanban-avatar" title={person.name} aria-hidden="true">
                  {initial(person.name)}
                </span>
              ))}
              {overflowCount > 0 ? (
                <span className="kanban-avatar kanban-avatar--more" aria-hidden="true">
                  +{overflowCount}
                </span>
              ) : null}
            </span>
          ) : null}
          {tags.length > 0 ? (
            <span className="kanban-card__tags">
              {tags.map((tag) => (
                <span key={tag.id} className="kanban-tag" style={{ color: tag.color }}>
                  <span className="kanban-tag__hash" aria-hidden="true">#</span>
                  {tag.name}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

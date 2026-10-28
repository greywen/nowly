import { CalendarDays, Paperclip } from '../components/icons';
import type { DragEvent } from 'react';
import { contentAttachments } from '../components/rich-text/content';
import type { ResolvedCard } from './kanban-view';
import { formatDueDate, isOverdue } from './kanban-view';
import { t } from '../i18n';
import { TaskStepCount } from '../tasks/TaskStepCount';
import { stepProgress } from '../tasks/task-model';

type KanbanCardProps = {
  resolved: ResolvedCard;
  todayIso: string;
  done?: boolean;
  onOpen: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
};

// A task card: a quadrant dot and the title, then one meta line that only
// renders the fields the task actually has. The card body drags; the title
// button opens the editor.
export function KanbanCard({
  resolved,
  todayIso,
  done = false,
  onOpen,
  onDragStart,
  onDragEnd
}: KanbanCardProps) {
  const { card, priority, tags } = resolved;

  // Counting attachments is a pure content parse, so a card costs no IO to show
  // its paperclip. Files only: an inline image is content, not an attachment.
  const { fileIds } = card.description
    ? contentAttachments(card.description)
    : { fileIds: [] };
  const attachmentCount = fileIds.length;
  const hasSteps = stepProgress(card.steps).total > 0;
  const overdue = Boolean(card.dueDate) && !done && isOverdue(card.dueDate!, todayIso);
  const hasMeta = Boolean(card.dueDate) || hasSteps || attachmentCount > 0 || tags.length > 0;

  return (
    <article
      className={`kanban-card${done ? ' kanban-card--done' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-label={t('kanbanCard.task', { title: card.title })}
    >
      <div className="kanban-card__head">
        {priority ? (
          <span
            className="kanban-card__quadrant"
            style={{ background: priority.color }}
            role="img"
            aria-label={priority.name}
            title={priority.name}
          />
        ) : null}
        <button type="button" className="kanban-card__title" onClick={onOpen}>
          {card.title}
        </button>
      </div>

      {hasMeta ? (
        <div className="kanban-card__meta">
          {card.dueDate ? (
            <span className={`kanban-card__date${overdue ? ' kanban-card__date--overdue' : ''}`}>
              <CalendarDays aria-hidden="true" />
              {formatDueDate(card.dueDate, todayIso)}
              {overdue ? <span className="visually-hidden">{t('kanbanCard.overdue')}</span> : null}
            </span>
          ) : null}
          <TaskStepCount steps={card.steps} />
          {attachmentCount > 0 ? (
            <span
              className="kanban-card__clip"
              aria-label={t('kanbanCard.attachments', { count: attachmentCount })}
            >
              <Paperclip aria-hidden="true" />
              {attachmentCount}
            </span>
          ) : null}
          {tags.map((tag) => (
            <span key={tag.id} className="kanban-tag" style={{ color: tag.color }}>
              <span className="kanban-tag__hash" aria-hidden="true">#</span>
              {tag.name}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
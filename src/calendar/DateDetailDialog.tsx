import { ListTodo, X } from 'lucide-react';
import { type RefObject, useId } from 'react';
import { Dialog } from '../components/Dialog';
import { formatChineseDate } from '../lib/date';
import { occurrenceKey } from '../lib/recurrence';
import type { MatrixTask } from '../matrix/matrix-model';
import type { Task } from '../tasks/task-model';
import {
  eventCategoryLabel,
  type CalendarEvent
} from './calendar-model';
import { t } from '../i18n';

type DateDetailDialogProps = {
  isoDate: string;
  events: CalendarEvent[];
  tasks: Array<MatrixTask | Task>;
  isTopLayer: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onCreateEvent: (date: string) => void;
  onCreateTask?: (date: string, trigger: HTMLElement) => void;
  onEditEvent: (event: CalendarEvent, trigger: HTMLElement) => void;
  onEditTask?: (task: Task, trigger: HTMLElement) => void;
};

function localDate(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function sortEvents(events: CalendarEvent[]) {
  return [...events].sort((left, right) => {
    if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
    return left.startAt.localeCompare(right.startAt)
      || left.endAt.localeCompare(right.endAt)
      || left.id.localeCompare(right.id);
  });
}

function eventAccessibleName(event: CalendarEvent) {
  const time = event.allDay ? t('calendar.allDay') : event.startAt.slice(11, 16);
  return t('calendar.eventLabel', { time, title: event.title, category: eventCategoryLabel(event.category) });
}

export function DateDetailDialog({
  isoDate,
  events,
  tasks,
  isTopLayer,
  restoreFocusRef,
  onClose,
  onCreateEvent,
  onCreateTask,
  onEditEvent,
  onEditTask
}: DateDetailDialogProps) {
  const titleId = useId();
  const dateEvents = sortEvents(events.filter((event) => event.startAt.startsWith(isoDate)));
  const taskTitles = new Map(tasks.map((task) => [task.id, task.title]));
  const dateTasks = tasks.filter((task): task is Task =>
    'dueDate' in task && task.dueDate === isoDate && task.views.includes('calendar')
  );
  const title = formatChineseDate(localDate(isoDate));

  return (
    <Dialog
      title={title}
      ariaLabelledBy={titleId}
      isTopLayer={isTopLayer}
      restoreFocusRef={restoreFocusRef}
      onRequestClose={onClose}
      className="date-detail-dialog"
      headerActions={
        <button type="button" className="good-icon-button" aria-label={t('dateDetail.close')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      }
      footer={
        <>
          {onCreateTask ? (
            <button type="button" className="good-button" onClick={(event) => onCreateTask(isoDate, event.currentTarget)}>
              {t('dateDetail.newTask')}
            </button>
          ) : null}
          <button type="button" className="good-button good-button--primary" onClick={() => onCreateEvent(isoDate)}>
            {t('dateDetail.newEvent')}
          </button>
        </>
      }
    >
      <p className="date-detail-dialog__summary">{t('dateDetail.summary', { count: dateEvents.length })}</p>
      <h3 className="date-detail-dialog__section-title">{t('dateDetail.eventsSection')}</h3>
      {dateEvents.length === 0 ? (
        <div className="date-detail-dialog__empty">{t('dateDetail.empty')}</div>
      ) : (
        <ul aria-label={t('dateDetail.dayEvents')} className="date-detail-dialog__list">
          {dateEvents.map((event) => {
            const linkedTaskTitle = event.linkedTaskId ? taskTitles.get(event.linkedTaskId) : undefined;
            return (
              <li key={occurrenceKey(event)}>
                <button
                  type="button"
                  aria-label={eventAccessibleName(event)}
                  className="date-detail-dialog__event"
                  onClick={(clickEvent) => onEditEvent(event, clickEvent.currentTarget)}
                >
                  <span className="date-detail-dialog__time">{event.allDay ? t('calendar.allDay') : event.startAt.slice(11, 16)}</span>
                  {event.startTz ? <span className="date-detail-dialog__tz">({event.startTz})</span> : null}
                  <span className="date-detail-dialog__event-copy">
                    <strong>{event.title}</strong>
                    {linkedTaskTitle ? <small>{t('dateDetail.linkedTask', { title: linkedTaskTitle })}</small> : null}
                  </span>
                  <span className={`date-detail-dialog__category date-detail-dialog__category--${event.category}`}>
                    {eventCategoryLabel(event.category)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <h3 className="date-detail-dialog__section-title">{t('dateDetail.tasksSection')}</h3>
      {dateTasks.length === 0 ? (
        <div className="date-detail-dialog__empty">{t('dateDetail.tasksEmpty')}</div>
      ) : (
        <ul aria-label={t('dateDetail.dayTasks')} className="date-detail-dialog__list">
          {dateTasks.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                aria-label={t('dateDetail.taskLabel', { title: task.title })}
                className={`date-detail-dialog__event date-detail-dialog__task${task.completed ? ' is-completed' : ''}`}
                onClick={(event) => onEditTask?.(task, event.currentTarget)}
              >
                <ListTodo aria-hidden="true" />
                <span className="date-detail-dialog__event-copy"><strong>{task.title}</strong></span>
                <span className="date-detail-dialog__category">{t('dateDetail.taskBadge')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

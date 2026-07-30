import { X } from 'lucide-react';
import { type RefObject, useId } from 'react';
import { Dialog } from '../components/Dialog';
import { formatChineseDate } from '../lib/date';
import type { MatrixTask } from '../matrix/matrix-model';
import {
  eventCategoryLabels,
  type CalendarEvent
} from './calendar-model';

type DateDetailDialogProps = {
  isoDate: string;
  events: CalendarEvent[];
  tasks: MatrixTask[];
  isTopLayer: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onCreateEvent: (date: string) => void;
  onCreateTask?: (date: string, trigger: HTMLElement) => void;
  onEditEvent: (event: CalendarEvent, trigger: HTMLElement) => void;
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
  const time = event.allDay ? '全天' : event.startAt.slice(11, 16);
  return `${time} ${event.title}，${eventCategoryLabels[event.category]}`;
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
  onEditEvent
}: DateDetailDialogProps) {
  const titleId = useId();
  const dateEvents = sortEvents(events.filter((event) => event.startAt.startsWith(isoDate)));
  const taskTitles = new Map(tasks.map((task) => [task.id, task.title]));
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
        <button type="button" className="good-icon-button" aria-label="关闭日期详情" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      }
      footer={
        <>
          {onCreateTask ? (
            <button type="button" className="good-button" onClick={(event) => onCreateTask(isoDate, event.currentTarget)}>
              新建任务
            </button>
          ) : null}
          <button type="button" className="good-button good-button--primary" onClick={() => onCreateEvent(isoDate)}>
            新建日程
          </button>
        </>
      }
    >
      <p className="date-detail-dialog__summary">共 {dateEvents.length} 个日程</p>
      {dateEvents.length === 0 ? (
        <div className="date-detail-dialog__empty">当天暂无日程</div>
      ) : (
        <ul aria-label="当日日程" className="date-detail-dialog__list">
          {dateEvents.map((event) => {
            const linkedTaskTitle = event.linkedTaskId ? taskTitles.get(event.linkedTaskId) : undefined;
            return (
              <li key={event.id}>
                <button
                  type="button"
                  aria-label={eventAccessibleName(event)}
                  className="date-detail-dialog__event"
                  onClick={(clickEvent) => onEditEvent(event, clickEvent.currentTarget)}
                >
                  <span className="date-detail-dialog__time">{event.allDay ? '全天' : event.startAt.slice(11, 16)}</span>
                  <span className="date-detail-dialog__event-copy">
                    <strong>{event.title}</strong>
                    {linkedTaskTitle ? <small>关联任务：{linkedTaskTitle}</small> : null}
                  </span>
                  <span className={`date-detail-dialog__category date-detail-dialog__category--${event.category}`}>
                    {eventCategoryLabels[event.category]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

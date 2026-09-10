import { X } from '../components/icons';
import { type RefObject, useId } from 'react';
import { Dialog } from '../components/Dialog';
import { formatChineseDate } from '../lib/date';
import { occurrenceKey } from '../lib/recurrence';
import {
  eventCategoryLabel,
  type CalendarEvent
} from './calendar-model';
import { t } from '../i18n';

type DateDetailDialogProps = {
  isoDate: string;
  events: CalendarEvent[];
  isTopLayer: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onCreateEvent: (date: string) => void;
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
  const time = event.allDay ? t('calendar.allDay') : event.startAt.slice(11, 16);
  return t('calendar.eventLabel', { time, title: event.title, category: eventCategoryLabel(event.category) });
}

export function DateDetailDialog({
  isoDate,
  events,
  isTopLayer,
  restoreFocusRef,
  onClose,
  onCreateEvent,
  onEditEvent
}: DateDetailDialogProps) {
  const titleId = useId();
  const dateEvents = sortEvents(events.filter((event) => event.startAt.startsWith(isoDate)));
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
        <button type="button" className="good-button good-button--primary" onClick={() => onCreateEvent(isoDate)}>
          {t('dateDetail.newEvent')}
        </button>
      }
    >
      <p className="date-detail-dialog__summary">{t('dateDetail.summary', { count: dateEvents.length })}</p>
      <h3 className="date-detail-dialog__section-title">{t('dateDetail.eventsSection')}</h3>
      {dateEvents.length === 0 ? (
        <div className="date-detail-dialog__empty">{t('dateDetail.empty')}</div>
      ) : (
        <ul aria-label={t('dateDetail.dayEvents')} className="date-detail-dialog__list">
          {dateEvents.map((event) => (
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
                </span>
                <span className={`date-detail-dialog__category date-detail-dialog__category--${event.category}`}>
                  {eventCategoryLabel(event.category)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

import { X } from 'lucide-react';
import type { RefObject } from 'react';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import type { CalendarEvent } from './calendar-model';

type Props = {
  event: CalendarEvent;
  sourceName: string;
  onClose: () => void;
  isTopLayer?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
};

// Split a "YYYY-MM-DDTHH:MM" wall clock into its date and time halves. The
// backend already converted to the device display timezone, so this is pure
// string work.
function splitWall(wall: string): { date: string; time: string } {
  const [date, time = ''] = wall.split('T');
  return { date, time };
}

// Shift an ISO date (YYYY-MM-DD) by a whole number of days. Used to render an
// all-day event's inclusive last day: ICS DTEND is exclusive, so a one-day
// event has end date = start date + 1.
function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// Build the human-readable time line. Handles same-day vs cross-day timed
// events and single vs multi-day all-day events so nothing looks like a
// negative duration or a lone "all day" with no date.
function formatTimeRange(event: CalendarEvent): string {
  const start = splitWall(event.startAt);
  const end = splitWall(event.endAt);
  if (event.allDay) {
    // DTEND is exclusive; the inclusive last day is end date - 1.
    const lastDay = addDaysIso(end.date, -1);
    const allDay = t('calendar.external.allDay');
    return lastDay > start.date
      ? `${start.date} – ${lastDay} · ${allDay}`
      : `${start.date} · ${allDay}`;
  }
  // Timed: show the end date too when the event crosses midnight.
  return end.date === start.date
    ? `${start.date} ${start.time}–${end.time}`
    : `${start.date} ${start.time} – ${end.date} ${end.time}`;
}

export function ExternalEventDialog({ event, sourceName, onClose, isTopLayer = true, restoreFocusRef }: Props) {
  const time = formatTimeRange(event);
  const location = event.externalLocation?.trim() || '';
  const description = event.externalDescription?.trim() || '';
  return (
    <Dialog
      title={t('calendar.external.title')}
      ariaLabelledBy="external-event-title"
      isTopLayer={isTopLayer}
      restoreFocusRef={restoreFocusRef}
      onRequestClose={onClose}
      className="external-event-dialog"
      headerActions={
        <button className="good-icon-button" aria-label={t('calendar.external.close')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      }
    >
      <div className="external-event">
        <h3 className="external-event__title" style={{ color: event.color }}>{event.title}</h3>
        <p className="external-event__time">
          {time}
          {event.startTz ? <span className="external-event__tz">{event.startTz}</span> : null}
        </p>
        {location ? (
          <p className="external-event__row">
            <span className="external-event__label">{t('calendar.external.location')}</span>
            {location}
          </p>
        ) : null}
        {description ? <p className="external-event__note">{description}</p> : null}
        <p className="external-event__row">
          <span className="external-event__label">{t('calendar.external.source')}</span>
          {sourceName}
        </p>
        <p className="external-event__readonly">{t('calendar.external.readonly')}</p>
      </div>
    </Dialog>
  );
}

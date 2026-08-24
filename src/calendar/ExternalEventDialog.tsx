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

// Format "YYYY-MM-DDTHH:MM" wall clock into a readable local string. The backend
// already converted to the device display timezone, so this is pure formatting.
function formatWall(wall: string, allDay: boolean): string {
  const [date, time] = wall.split('T');
  return allDay ? date : `${date} ${time ?? ''}`.trim();
}

export function ExternalEventDialog({ event, sourceName, onClose, isTopLayer = true, restoreFocusRef }: Props) {
  const time = event.allDay
    ? t('calendar.external.allDay')
    : `${formatWall(event.startAt, false)} – ${formatWall(event.endAt, false).split(' ')[1] ?? ''}`.trim();
  // note carries "location\ndescription"; split so the location shows in its own
  // row and the note block below shows only the remaining description lines.
  const noteLines = event.note.split('\n');
  const location = noteLines[0]?.trim() || '';
  const description = noteLines.slice(1).join('\n').trim();
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

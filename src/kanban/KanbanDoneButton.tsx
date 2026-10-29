import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from '../components/icons';
import { t } from '../i18n';
import { DONE_HOLD_EVENT, DONE_LAND_EVENT, playDoneLanding, prefersReducedMotion } from '../tasks/completion-celebration';
import { groupDoneEntries, isRecentDone, type DoneEntry, type DoneGroupKey } from './kanban-done';

type KanbanDoneButtonProps = {
  entries: DoneEntry[];
  now: Date;
  pendingTaskIds: Set<string>;
  onReopen(taskId: string): void;
};

const groupLabelKey: Record<DoneGroupKey, string> = {
  today: 'kanbanDone.groupToday',
  week: 'kanbanDone.groupWeek',
  earlier: 'kanbanDone.groupEarlier'
};

function completedOn(iso: string, now: Date): string {
  const date = new Date(iso);
  return date.toDateString() === now.toDateString()
    ? t('kanbanDone.groupToday')
    : t('kanbanDue.monthDay', { month: date.getMonth() + 1, day: date.getDate() });
}

// Toolbar entry for tasks completed on the board. Completed tasks keep their
// lane but leave the columns, so this is where they can be reviewed and
// reopened. Its icon is the landing target of the completion stamp.
export function KanbanDoneButton({ entries, now, pendingTaskIds, onReopen }: KanbanDoneButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [held, setHeld] = useState(0);
  const [flash, setFlash] = useState(false);
  const [rect, setRect] = useState<{ top: number; right: number } | null>(null);

  const recent = entries.filter((entry) => isRecentDone(entry, now));
  const shown = showAll ? entries : recent;
  const groups = groupDoneEntries(shown, now);
  // The count holds its old value while a completion stamp is in flight.
  const count = Math.max(0, recent.length - held);

  useEffect(() => {
    let flashTimer = 0;
    const hold = () => setHeld((value) => value + 1);
    const land = () => {
      setHeld((value) => Math.max(0, value - 1));
      if (!playDoneLanding(iconRef.current, countRef.current) && prefersReducedMotion()) {
        setFlash(true);
        window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => setFlash(false), 1000);
      }
    };
    window.addEventListener(DONE_HOLD_EVENT, hold);
    window.addEventListener(DONE_LAND_EVENT, land);
    return () => {
      window.removeEventListener(DONE_HOLD_EVENT, hold);
      window.removeEventListener(DONE_LAND_EVENT, land);
      window.clearTimeout(flashTimer);
    };
  }, []);

  // Portaled and fixed for the same reason as FilterSelect: the module body
  // contains and clips absolutely positioned descendants.
  useLayoutEffect(() => {
    if (!open) return;
    function measure() {
      const box = triggerRef.current?.getBoundingClientRect();
      if (box) setRect({ top: box.bottom + 8, right: Math.max(16, window.innerWidth - box.right) });
    }
    measure();
    function dismiss(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`btn kanban-done-button${flash ? ' kanban-done-button--flash' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('kanbanDone.buttonLabel', { count })}
        title={t('kanbanDone.buttonLabel', { count })}
        onClick={() => setOpen((value) => !value)}
      >
        <span ref={iconRef} className="kanban-done-button__icon" data-done-target="">
          <Check aria-hidden="true" />
        </span>
        <span aria-hidden="true">{t('kanbanDone.title')}</span>
        <span ref={countRef} className="kanban-done-button__count" aria-hidden="true">{count}</span>
      </button>
      {open
        ? createPortal(
            <div
              ref={popupRef}
              className="kanban-done-popup"
              role="dialog"
              aria-labelledby={titleId}
              style={rect ? { top: `${rect.top}px`, right: `${rect.right}px` } : { visibility: 'hidden' }}
            >
              <div className="kanban-done-popup__head">
                <h3 id={titleId}>{t('kanbanDone.title')}</h3>
                <span className="kanban-done-popup__range">
                  {showAll ? t('kanbanDone.rangeAll', { count: entries.length }) : t('kanbanDone.rangeRecent', { count: recent.length })}
                </span>
              </div>
              <div className="kanban-done-popup__body">
                {groups.length === 0 ? <p className="kanban-done-popup__empty">{t('kanbanDone.empty')}</p> : null}
                {groups.map((group) => (
                  <section key={group.key} className="kanban-done-group" aria-label={t(groupLabelKey[group.key])}>
                    <p className="kanban-done-group__label" aria-hidden="true">{t(groupLabelKey[group.key])}</p>
                    {group.entries.map(({ task, lane }) => (
                      <label key={task.id} className="kanban-done-item" title={t('kanbanDone.reopenHint', { lane: lane.name })}>
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked
                          disabled={pendingTaskIds.has(task.id)}
                          aria-label={t('taskRow.markIncomplete', { title: task.title })}
                          onChange={() => onReopen(task.id)}
                        />
                        <span className="kanban-done-item__copy">
                          <span className="kanban-done-item__title">{task.title}</span>
                          <span className="kanban-done-item__meta">
                            {lane.name} · {task.completedAt ? completedOn(task.completedAt, now) : ''}
                          </span>
                        </span>
                      </label>
                    ))}
                  </section>
                ))}
              </div>
              {entries.length > recent.length ? (
                <div className="kanban-done-popup__foot">
                  <button type="button" className="kanban-done-popup__more" onClick={() => setShowAll((value) => !value)}>
                    {showAll ? t('kanbanDone.showRecent') : t('kanbanDone.showAll', { count: entries.length })}
                  </button>
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

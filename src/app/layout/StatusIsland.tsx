import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, CircleAlert, Pause, Play, RefreshCw, Sparkles, Timer, X } from '../../components/icons';
import { useTranslation } from '../../i18n';
import type { CalendarEvent } from '../../calendar/calendar-model';
import {
  statusIslandPrimaryKey,
  statusIslandPrimaryRank,
  type StatusIslandModel,
  type StatusIslandPrimary,
  type StatusIslandSignal
} from '../status-island-model';

type Props = {
  model: StatusIslandModel;
  surface?: 'combined' | 'trigger' | 'details';
  readOnly?: boolean;
  active?: boolean;
  onToggleDetails?: () => void;
  onDismissPrimary?: (key: string) => void;
  onDismissDetails?: () => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTask: (id: string) => void;
  onStartFocus: () => void;
  onPauseFocus: () => void;
  onResumeFocus: () => void;
  onOpenQuickPanel: () => void;
  onRetryStatus?: () => void;
};

function formatCountdown(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatTime(value: string): string {
  return value.slice(11, 16);
}

function PrimaryIcon({ primary }: { primary: StatusIslandPrimary }) {
  if (primary.kind === 'focus') return <Timer aria-hidden="true" />;
  if (primary.kind === 'event') return <CalendarDays aria-hidden="true" />;
  if (primary.kind === 'task') return <Check aria-hidden="true" />;
  return <Sparkles aria-hidden="true" />;
}

function useStableModel(model: StatusIslandModel): StatusIslandModel {
  const [displayed, setDisplayed] = useState(model);
  const displayedRef = useRef(model);
  const shownAt = useRef(Date.now());

  useEffect(() => {
    const current = displayedRef.current;
    const samePrimary = statusIslandPrimaryKey(current.primary) === statusIslandPrimaryKey(model.primary);
    const higherPriority = statusIslandPrimaryRank(model.primary) < statusIslandPrimaryRank(current.primary);
    const currentStillValid = model.candidateKeys?.includes(statusIslandPrimaryKey(current.primary)) ?? false;
    const currentInvalid = model.candidateKeys !== undefined && !currentStillValid;
    const samePriority = statusIslandPrimaryRank(model.primary) === statusIslandPrimaryRank(current.primary);
    const elapsed = Date.now() - shownAt.current;
    if (samePrimary) {
      displayedRef.current = model;
      setDisplayed(model);
      return;
    }
    if (samePriority && currentStillValid) {
      const retained = { ...model, primary: current.primary };
      displayedRef.current = retained;
      setDisplayed(retained);
      return;
    }
    if (higherPriority || currentInvalid || elapsed >= 4000) {
      displayedRef.current = model;
      shownAt.current = Date.now();
      setDisplayed(model);
      return;
    }
    const timeout = window.setTimeout(() => {
      displayedRef.current = model;
      shownAt.current = Date.now();
      setDisplayed(model);
    }, 4000 - elapsed);
    return () => window.clearTimeout(timeout);
  }, [model]);

  return displayed;
}

export function StatusIsland({
  model,
  surface = 'combined',
  readOnly = false,
  active = true,
  onToggleDetails,
  onDismissPrimary,
  onDismissDetails,
  onOpenEvent,
  onOpenTask,
  onStartFocus,
  onPauseFocus,
  onResumeFocus,
  onOpenQuickPanel,
  onRetryStatus
}: Props) {
  const { t } = useTranslation();
  const displayedModel = useStableModel(model);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function dismissOnPointer(event: PointerEvent) {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', dismissOnPointer);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointer);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (surface !== 'details' || !onDismissDetails) return;
    const dismiss = onDismissDetails;
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') dismiss();
    }
    document.addEventListener('keydown', dismissOnEscape);
    return () => document.removeEventListener('keydown', dismissOnEscape);
  }, [onDismissDetails, surface]);

  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);

  const primary = primaryCopy(displayedModel.primary, t);
  const primaryKey = statusIslandPrimaryKey(displayedModel.primary);
  const dismissible = displayedModel.primary.kind === 'event' || displayedModel.primary.kind === 'task';
  const label = [primary.title, primary.meta, ...displayedModel.signals.map(signal => signalCopy(signal, t))].join(' · ');
  const content = <span className="status-island__content" key={primaryKey}>
    <span className="status-island__icon"><PrimaryIcon primary={displayedModel.primary} /></span>
    <span className="status-island__copy"><strong>{primary.title}</strong><span>{primary.meta}</span></span>
    <span className="status-island__signals" aria-hidden="true">
      {displayedModel.signals.map(signal => <span className={`status-island__signal${signal.kind === 'conflict' ? ' is-alert' : ''}`} key={signalKey(signal)}>{signalCopy(signal, t)}</span>)}
    </span>
  </span>;

  const details = (
    <section className="status-island__details" id="status-island-details" aria-label={t('statusIsland.details')}
      aria-hidden={surface === 'combined' ? !open : false} inert={surface === 'combined' && !open ? true : undefined}>
      {displayedModel.details.nextEvent ? (
        <button className="status-island__row" type="button" aria-label={t('statusIsland.openEvent', { title: displayedModel.details.nextEvent.title })} onClick={() => onOpenEvent(displayedModel.details.nextEvent!)}>
          <CalendarDays aria-hidden="true" /><span><small>{t('statusIsland.nextEvent')}</small><strong>{displayedModel.details.nextEvent.title}</strong></span>
          <time dateTime={displayedModel.details.nextEvent.startAt}>{displayedModel.details.nextEvent.allDay ? t('calendar.allDay') : formatTime(displayedModel.details.nextEvent.startAt)}</time>
        </button>
      ) : <p className="status-island__empty">{t('statusIsland.noEvent')}</p>}
      {displayedModel.details.importantTask ? (
        <button className="status-island__row" type="button" aria-label={t('statusIsland.openTask', { title: displayedModel.details.importantTask.title })} onClick={() => onOpenTask(displayedModel.details.importantTask!.id)}>
          <CircleAlert aria-hidden="true" /><span><small>{t('statusIsland.importantTask')}</small><strong>{displayedModel.details.importantTask.title}</strong></span>
          <span>{displayedModel.details.importantTask.dueDate ?? t('statusIsland.noDueDate')}</span>
        </button>
      ) : <p className="status-island__empty">{t('statusIsland.noImportantTask')}</p>}
      <div className="status-island__row status-island__focus-row">
        <Timer aria-hidden="true" /><span><small>{t('statusIsland.focus')}</small><strong>{focusLabel(displayedModel.details.focus.status, t)}</strong></span>
        {displayedModel.details.focus.status === 'running' ? <button type="button" onClick={onPauseFocus}><Pause aria-hidden="true" />{t('statusIsland.pauseFocus')}</button> : null}
        {displayedModel.details.focus.status === 'paused' ? <button type="button" onClick={onResumeFocus}><Play aria-hidden="true" />{t('statusIsland.resumeFocus')}</button> : null}
        {displayedModel.details.focus.status === 'idle' ? <button type="button" onClick={onStartFocus}><Play aria-hidden="true" />{t('statusIsland.startFocus')}</button> : null}
      </div>
      <div className={`status-island__footer${onRetryStatus ? ' has-retry' : ''}`}>
        <button type="button" className="btn btn-primary" onClick={onOpenQuickPanel}><Sparkles aria-hidden="true" />{t('statusIsland.askNowly')}</button>
        {onRetryStatus ? <button type="button" className="status-island__retry" aria-label={t('statusIsland.retry')} onClick={onRetryStatus}><RefreshCw aria-hidden="true" /></button> : null}
      </div>
    </section>
  );

  if (surface === 'details') {
    return <div className="status-island status-island--details" data-open="true" data-primary={displayedModel.primary.kind}>{details}</div>;
  }

  const toggle = () => {
    if (surface === 'trigger' && onToggleDetails) onToggleDetails();
    else setOpen(value => !value);
  };

  return (
    <div className="status-island" data-open={open} data-primary={displayedModel.primary.kind} ref={rootRef}>
      {readOnly ? (
        <div className="status-island__trigger" role="status" aria-label={label}>{content}</div>
      ) : (
        <div className={`status-island__trigger-shell${dismissible && onDismissPrimary ? ' has-dismiss' : ''}`}>
          <button type="button" className="status-island__trigger" aria-label={label} aria-expanded={surface === 'combined' ? open : undefined}
            aria-controls={surface === 'combined' ? 'status-island-details' : undefined} aria-haspopup={surface === 'trigger' ? 'dialog' : undefined}
            disabled={!active} ref={triggerRef} onClick={toggle}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              toggle();
            }}>{content}</button>
          {dismissible && onDismissPrimary ? (
            <button type="button" className="status-island__dismiss" aria-label={t('statusIsland.dismiss', { title: primary.title })}
              onClick={() => onDismissPrimary(primaryKey)}><X aria-hidden="true" /></button>
          ) : null}
        </div>
      )}
      {!readOnly && surface === 'combined' ? details : null}
    </div>
  );
}

function primaryCopy(primary: StatusIslandPrimary, t: ReturnType<typeof useTranslation>['t']) {
  if (primary.kind === 'loading') return { title: t('statusIsland.now'), meta: t('statusIsland.loading') };
  if (primary.kind === 'focus') return {
    title: primary.status === 'completed' ? t('statusIsland.focusCompleted') : t('statusIsland.focusTitle'),
    meta: primary.status === 'paused' ? t('statusIsland.focusPaused', { time: formatCountdown(primary.remainingSeconds) })
      : primary.status === 'completed' ? t('statusIsland.focusCompleteMeta')
        : t('statusIsland.focusRunning', { time: formatCountdown(primary.remainingSeconds) })
  };
  if (primary.kind === 'event') return {
    title: primary.title,
    meta: primary.phase === 'ongoing' ? t('statusIsland.eventOngoing', { time: formatTime(primary.endAt) })
      : primary.phase === 'imminent' ? t('statusIsland.eventImminent', { time: formatTime(primary.startAt) })
        : t('statusIsland.eventNext', { time: formatTime(primary.startAt) })
  };
  if (primary.kind === 'task') return { title: primary.title, meta: t('statusIsland.taskMeta') };
  return { title: t('statusIsland.now'), meta: t('statusIsland.summary', { events: primary.remainingEventCount, tasks: primary.importantTaskCount }) };
}

function focusLabel(status: StatusIslandModel['details']['focus']['status'], t: ReturnType<typeof useTranslation>['t']): string {
  if (status === 'running') return t('statusIsland.focusRunningShort');
  if (status === 'paused') return t('statusIsland.focusPausedShort');
  if (status === 'completed') return t('statusIsland.focusCompleted');
  return t('statusIsland.focusIdle');
}

function signalKey(signal: StatusIslandSignal): string {
  return signal.kind === 'event' ? `event:${signal.eventId}` : signal.kind;
}

function signalCopy(signal: StatusIslandSignal, t: ReturnType<typeof useTranslation>['t']): string {
  if (signal.kind === 'conflict') return t('statusIsland.conflict', { count: signal.count });
  if (signal.kind === 'event') return formatTime(signal.startAt);
  return t('statusIsland.taskCount', { count: signal.count });
}
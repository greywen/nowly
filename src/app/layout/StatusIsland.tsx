import {
  AlertTriangle,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  Pause,
  Play,
  RefreshCw,
  Square,
  Timer,
  X
} from '../../components/icons';
import { useTranslation } from '../../i18n';
import type { CalendarEvent } from '../../calendar/calendar-model';
import type { Task } from '../../tasks/task-model';
import type {
  StatusIslandFocusIndicator,
  StatusIslandMarker,
  StatusIslandOverviewGroup,
  StatusIslandPanelContext,
  StatusIslandReminder,
  StatusIslandSummary
} from '../status-island-model';

// The top rail is one object in two sizes. Collapsed it splits into two halves:
// the 240x40 status capsule and the 40px Nowly entry dot, with an 8px gap. Opened
// it merges into one 288x288 sheet — the capsule grown, not a second popup.
//
// The capsule carries exactly one of three things, always on the same slots and
// at the same size, so switching content never moves or resizes anything:
//   idle    — nothing at all to report;
//   detail  — one reminder, in full;
//   summary — today's aggregate.
//
// Which of detail and summary is shown is the user's choice: the notification
// setting picks the starting mode, and closing a detail downgrades that one
// reminder to the summary for the rest of the local day. Nothing switches on a
// timer.
//
// The only motion in here is the rail growing and collapsing, which design.md
// §10 admits as a named exception. Everything else updates immediately;
// per-second focus redraws are time data, not decoration.

type Translate = ReturnType<typeof useTranslation>['t'];

function formatCountdown(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatTime(value: string): string {
  return value.slice(11, 16);
}

export function focusStatusText(focus: StatusIslandFocusIndicator, t: Translate): string {
  if (focus.status === 'completed') return t('statusIsland.focusCompletedStatus');
  const key = focus.status === 'paused' ? 'statusIsland.focusPausedStatus' : 'statusIsland.focusRunningStatus';
  return t(key, { minutes: focus.remainingMinutes });
}

export function markerText(marker: StatusIslandMarker, t: Translate): string {
  const keys = {
    conflict: 'statusIsland.markerConflict',
    ongoingEvent: 'statusIsland.markerOngoingEvent',
    imminentEvent: 'statusIsland.markerImminentEvent',
    urgentTask: 'statusIsland.markerUrgentTask',
    event: 'statusIsland.markerEvent',
    importantTask: 'statusIsland.markerImportantTask',
    allDay: 'statusIsland.markerAllDay'
  } as const;
  return t(keys[marker.kind], { count: marker.count });
}

// The capsule is narrow, so it gets a shortened phrase. It still carries a unit
// word rather than a bare digit: "2" alone does not say two of what, and the
// icon is a category hint, not a label.
export function markerTextShort(marker: StatusIslandMarker, t: Translate): string {
  const keys = {
    conflict: 'statusIsland.markerConflictShort',
    ongoingEvent: 'statusIsland.markerOngoingEventShort',
    imminentEvent: 'statusIsland.markerImminentEventShort',
    urgentTask: 'statusIsland.markerUrgentTaskShort',
    event: 'statusIsland.markerEventShort',
    importantTask: 'statusIsland.markerImportantTaskShort',
    allDay: 'statusIsland.markerAllDayShort'
  } as const;
  return t(keys[marker.kind], { count: marker.count });
}

function MarkerIcon({ kind }: { kind: StatusIslandMarker['kind'] }) {
  if (kind === 'conflict') return <AlertTriangle aria-hidden="true" />;
  if (kind === 'urgentTask' || kind === 'importantTask') return <Check aria-hidden="true" />;
  if (kind === 'allDay') return <CalendarDays aria-hidden="true" />;
  return <Clock3 aria-hidden="true" />;
}

type SurfaceProps = {
  onActivate?: () => void;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
  onFocusEnter?: () => void;
  onFocusLeave?: () => void;
  /** Long press, then move: parks the rail along the top edge. */
  onGrab?: (event: React.PointerEvent) => void;
  /** Keyboard equivalent of that move. Negative is left. */
  onNudge?: (steps: number) => void;
  dragging?: boolean;
  /** Whether this half's sheet is currently open. */
  expanded?: boolean;
};

function surfaceHandlers({ onActivate, onHoverStart, onHoverEnd, onFocusEnter, onFocusLeave, onGrab, onNudge }: SurfaceProps) {
  return {
    onClick: onActivate,
    onMouseEnter: onHoverStart,
    onMouseLeave: onHoverEnd,
    onFocus: onFocusEnter,
    onBlur: onFocusLeave,
    onPointerDown: onGrab,
    onKeyDown: (event: React.KeyboardEvent) => {
      // The drag needs an equivalent that is not a pointer gesture, so the arrow
      // keys move the island the same way the long press does.
      if (onNudge && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        onNudge(event.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onActivate?.();
    }
  };
}

function reminderCopy(reminder: StatusIslandReminder, t: Translate): { title: string; meta: string } {
  const subject = reminder.subject;
  if (subject.kind === 'conflict') {
    return {
      title: t('statusIsland.conflictPanel'),
      meta: t('statusIsland.markerConflict', { count: subject.events.length })
    };
  }
  if (subject.kind === 'focus') {
    const indicator: StatusIslandFocusIndicator = {
      status: subject.status,
      remainingSeconds: subject.remainingSeconds,
      remainingMinutes: Math.ceil(subject.remainingSeconds / 60),
      plannedSeconds: subject.plannedSeconds,
      progressMax: subject.plannedSeconds,
      progressNow: subject.remainingSeconds
    };
    return {
      title: subject.status === 'completed' ? t('statusIsland.focusCompleted') : t('statusIsland.focusTitle'),
      meta: subject.status === 'completed'
        ? t('statusIsland.focusCompleteMeta')
        : `${focusStatusText(indicator, t)} · ${formatCountdown(subject.remainingSeconds)}`
    };
  }
  if (subject.kind === 'event') {
    if (subject.stage === 'start') {
      return { title: subject.event.title, meta: t('statusIsland.eventEndsAt', { time: formatTime(subject.event.endAt) }) };
    }
    const lead = subject.reminderMinutes === null
      ? ''
      : ` · ${t('statusIsland.reminderLead', { minutes: subject.reminderMinutes })}`;
    return {
      title: subject.event.title,
      meta: `${t('statusIsland.eventStartsAt', { time: formatTime(subject.event.startAt) })}${lead}`
    };
  }
  return {
    title: subject.task.title,
    meta: subject.task.dueDate
      ? t('statusIsland.taskDue', { date: subject.task.dueDate })
      : t('statusIsland.taskMeta')
  };
}

function ReminderIcon({ reminder }: { reminder: StatusIslandReminder }) {
  const kind = reminder.subject.kind;
  if (kind === 'conflict') return <AlertTriangle aria-hidden="true" />;
  if (kind === 'focus') return <Timer aria-hidden="true" />;
  if (kind === 'event') return <CalendarDays aria-hidden="true" />;
  return <Check aria-hidden="true" />;
}

/**
 * The island. It exists only while a reminder is unseen, or inside the 15s hold
 * after the user acknowledged it. `onDismiss` closes this surface only: it is
 * not acknowledgement and not business consumption.
 */
// Marker kinds are finer-grained than the island's icon styling, which only
// distinguishes four families. Normalising here lets both modes share one set of
// CSS rules instead of the summary growing a parallel set.
function markerFamily(kind: StatusIslandMarker['kind']): string {
  if (kind === 'conflict') return 'conflict';
  if (kind === 'urgentTask' || kind === 'importantTask') return 'task';
  return 'event';
}

// Extra ARIA for the title slot. The focus countdown is a progress readout, and
// in summary mode the countdown *is* the title, so the role has to land on that
// element rather than on a separate node that would break slot parity.
type TitleAria = React.AriaAttributes & { role?: string };

type IslandShellProps = {
  family: string;
  tone?: StatusIslandMarker['tone'];
  lifecycle?: string;
  mode: 'idle' | 'detail' | 'summary';
  icon: React.ReactElement;
  title: string;
  titleAria?: TitleAria;
  meta: string;
  metaAria?: TitleAria;
  markers: StatusIslandMarker[];
  label: string;
  dismiss?: { onDismiss: () => void; label: string };
  onRetryStatus?: () => void;
} & SurfaceProps;

/**
 * The capsule's head. All three modes render through it, so the icon, title and
 * meta land on identical pixels whatever the capsule is carrying — and, because
 * the head is laid out at its *expanded* width and clipped by the sheet, on
 * identical pixels in both sizes of the rail too (design.md §10).
 *
 * The hit area is a sibling overlay rather than a button wrapped around the text:
 * the sheet owns the border and background now, and the two dismiss buttons have
 * to sit above the same pixels the hit area covers.
 */
function IslandShell({
  family,
  tone,
  lifecycle,
  mode,
  icon,
  title,
  titleAria,
  meta,
  metaAria,
  markers,
  label,
  dismiss,
  onRetryStatus,
  ...surface
}: IslandShellProps) {
  const { t } = useTranslation();
  return (
    <div
      className="status-island"
      data-primary={family}
      data-mode={mode}
      {...(surface.dragging ? { 'data-dragging': 'true' } : {})}
      {...(tone ? { 'data-tone': tone } : {})}
      {...(lifecycle ? { 'data-lifecycle': lifecycle } : {})}
    >
      <span className="status-island__content">
        <span className="status-island__icon">{icon}</span>
        <span className="status-island__copy">
          <strong {...titleAria}>{title}</strong>
          <span {...metaAria}>{meta}</span>
        </span>
      </span>
      <span className="status-island__signals" aria-hidden="true">
        {markers.map(marker => (
          <span className={`status-island__signal is-${marker.tone}`} key={marker.kind}>{marker.count}</span>
        ))}
      </span>
      <button
        type="button"
        className="status-island__trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={surface.expanded ?? false}
        {...(surface.onNudge ? { 'aria-keyshortcuts': 'ArrowLeft ArrowRight' } : {})}
        {...surfaceHandlers(surface)}
      />
      {dismiss ? (
        <button
          type="button"
          className="status-island__dismiss"
          data-at="collapsed"
          aria-label={dismiss.label}
          onClick={dismiss.onDismiss}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
      {onRetryStatus ? (
        <button
          type="button"
          className="screen-status-island-error"
          aria-label={t('statusIsland.retry')}
          onClick={onRetryStatus}
        >
          <RefreshCw aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Idle content: the day holds nothing at all. The capsule does not shrink away —
 * there is no smaller shape any more — it just goes quiet, and stays the thing
 * the user clicks to open the rail.
 */
export function StatusIslandIdleView({ onRetryStatus, dragHintVisible = true, onAcknowledgeDragHint, ...surface }: { onRetryStatus?: () => void; dragHintVisible?: boolean; onAcknowledgeDragHint?: () => void } & SurfaceProps) {
  const { t } = useTranslation();
  const title = t('statusIsland.idleTitle');
  const meta = t('statusIsland.idleMeta');
  return (
    <>
    {dragHintVisible ? <div className="status-island__drag-hint" role="status"><strong>{t('statusIsland.dragHintTitle')}</strong><span>{t('statusIsland.dragHint')}</span><button type="button" onClick={onAcknowledgeDragHint}>{t('statusIsland.dragHintAcknowledge')}</button></div> : null}
    <IslandShell
      family="event"
      mode="idle"
      icon={<Check aria-hidden="true" />}
      title={title}
      meta={meta}
      markers={[]}
      label={`${title} · ${meta}`}
      {...(onRetryStatus ? { onRetryStatus } : {})}
      {...surface}
    />
    </>
  );
}

function reminderFocusIndicator(reminder: StatusIslandReminder): StatusIslandFocusIndicator | null {
  const subject = reminder.subject;
  if (subject.kind !== 'focus') return null;
  return {
    status: subject.status,
    remainingSeconds: subject.remainingSeconds,
    remainingMinutes: Math.ceil(subject.remainingSeconds / 60),
    plannedSeconds: subject.plannedSeconds,
    progressMax: subject.plannedSeconds,
    progressNow: subject.remainingSeconds
  };
}

/**
 * Detail content: one reminder, in full. Shown until the user closes it with the
 * dismiss button, which downgrades the island to the summary rather than hiding
 * the surface. Nothing collapses on a timer.
 */
export function StatusIslandReminderView({
  reminder,
  markers,
  onDismiss,
  onRetryStatus,
  ...surface
}: {
  reminder: StatusIslandReminder;
  markers: StatusIslandMarker[];
  onDismiss?: () => void;
  onRetryStatus?: () => void;
} & SurfaceProps) {
  const { t } = useTranslation();
  const copy = reminderCopy(reminder, t);
  // Focus state is owned by the native timer, so it cannot be dismissed.
  const dismissible = reminder.subject.kind !== 'focus' && Boolean(onDismiss);
  const label = [copy.title, copy.meta, ...markers.map(marker => markerText(marker, t))].join(' · ');
  // The countdown lives in the meta line here, so that is where the progress
  // readout has to be. A running session now stays in detail for as long as it
  // runs, so without this the countdown would never be exposed as progress.
  const focus = reminderFocusIndicator(reminder);
  return (
    <IslandShell
      family={reminder.subject.kind}
      lifecycle={reminder.lifecycle}
      mode="detail"
      icon={<ReminderIcon reminder={reminder} />}
      title={copy.title}
      meta={copy.meta}
      {...(focus
        ? {
          metaAria: {
            role: 'progressbar',
            'aria-label': t('statusIsland.focusProgress'),
            'aria-valuemin': 0,
            'aria-valuemax': focus.progressMax,
            'aria-valuenow': focus.progressNow,
            'aria-valuetext': focusStatusText(focus, t)
          }
        }
        : {})}
      markers={markers}
      label={label}
      {...(dismissible && onDismiss
        ? { dismiss: { onDismiss, label: t('statusIsland.dismiss', { title: copy.title }) } }
        : {})}
      {...(onRetryStatus ? { onRetryStatus } : {})}
      {...surface}
    />
  );
}

// Focus outranks markers, matching the model's own priority order: a running
// session is the one thing the user started deliberately and is watching.
function summaryContent(summary: StatusIslandSummary, t: Translate): {
  family: string;
  tone?: StatusIslandMarker['tone'];
  icon: React.ReactElement;
  title: string;
  titleAria?: TitleAria;
} {
  const focus = summary.focus;
  if (focus) {
    if (focus.status === 'completed') {
      // Deliberately not the detail's `focusCompleted`: the summary is what the
      // island shows *after* the completion was dealt with, so it reads as a
      // state ("专注已完成") rather than as a fresh announcement.
      return {
        family: 'focus',
        tone: 'green',
        icon: <Check aria-hidden="true" />,
        title: focusStatusText(focus, t)
      };
    }
    return {
      family: 'focus',
      tone: 'teal',
      icon: focus.status === 'paused' ? <Pause aria-hidden="true" /> : <Timer aria-hidden="true" />,
      title: formatCountdown(focus.remainingSeconds),
      titleAria: {
        role: 'progressbar',
        'aria-label': t('statusIsland.focusProgress'),
        'aria-valuemin': 0,
        'aria-valuemax': focus.progressMax,
        'aria-valuenow': focus.progressNow,
        'aria-valuetext': focusStatusText(focus, t)
      }
    };
  }
  const lead = summary.lead;
  if (lead) {
    return {
      family: markerFamily(lead.kind),
      tone: lead.tone,
      icon: <MarkerIcon kind={lead.kind} />,
      title: markerTextShort(lead, t)
    };
  }
  return { family: 'event', icon: <CalendarDays aria-hidden="true" />, title: t('statusIsland.overviewPanel') };
}

/**
 * Summary content: today's aggregate, in the same frame and on the same slots as
 * the detail. The meta line is always the day's total rather than a list of the
 * remaining markers, so it reads the same from one minute to the next instead of
 * reflowing every time a count changes.
 */
export function StatusIslandSummaryView({
  summary,
  onRetryStatus,
  ...surface
}: {
  summary: StatusIslandSummary;
  onRetryStatus?: () => void;
} & SurfaceProps) {
  const { t } = useTranslation();
  const content = summaryContent(summary, t);
  const meta = summary.totalCount > 0
    ? t('statusIsland.todayTotal', { count: summary.totalCount })
    : t('statusIsland.todayClear');
  // Every marker is named in the accessible name, not just the three that fit in
  // the signals row, so colour and count badges are never the only carrier.
  const label = [content.title, meta, ...summary.markers.map(marker => markerText(marker, t))].join(' · ');
  return (
    <IslandShell
      family={content.family}
      {...(content.tone ? { tone: content.tone } : {})}
      mode="summary"
      icon={content.icon}
      title={content.title}
      {...(content.titleAria ? { titleAria: content.titleAria } : {})}
      meta={meta}
      markers={summary.markers.slice(0, 3)}
      label={label}
      {...(onRetryStatus ? { onRetryStatus } : {})}
      {...surface}
    />
  );
}

/**
 * The rail: one sheet, two halves and two sizes.
 *
 * The sheet is the only surface. Collapsed it is the 240x40 capsule; open it is
 * the whole 288x288. Its content is laid out at the open size and simply gets
 * uncovered as the sheet grows, so nothing inside reflows or moves (design.md
 * §10). The Nowly dot is a sibling rather than sheet content precisely because it
 * has to stay visible outside the collapsed sheet, and it fades once the sheet
 * has grown over it.
 *
 * `anim` is null until the first transition, so the rail does not animate itself
 * into existence on mount.
 */
export function TopRail({
  open,
  source,
  anim,
  mode,
  panel,
  nowly,
  onCollapse,
  children
}: {
  open: boolean;
  source: 'island' | 'nowly';
  anim: 'grow' | 'shrink' | null;
  mode: 'idle' | 'detail' | 'summary';
  panel: React.ReactNode;
  nowly: SurfaceProps;
  onCollapse: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="status-rail"
      data-open={open}
      data-source={source}
      data-mode={mode}
      data-dragging={nowly.dragging ?? false}
      {...(anim ? { 'data-anim': anim } : {})}
    >
      <div className="status-rail__sheet">
        <div className="status-rail__content">
          <div className="status-rail__header">
            {children}
            <div className="status-rail__nowly-head" data-for="nowly" aria-hidden={!(open && source === 'nowly')}>
              <span className="status-island__icon"><img src="/logo.png" alt="" /></span>
              <span className="status-island__copy">
                <strong>{t('statusIsland.nowly')}</strong>
                <span>{t('statusIsland.nowlyMeta')}</span>
              </span>
            </div>
          </div>
          <div className="status-rail__panel">{panel}</div>
        </div>
      </div>
      <button
        type="button"
        className="status-island__dismiss"
        data-at="expanded"
        aria-label={t('statusIsland.collapse')}
        onClick={onCollapse}
      >
        <X aria-hidden="true" />
      </button>
      <button
        type="button"
        className="status-rail__nowly"
        aria-label={t('statusIsland.nowly')}
        aria-haspopup="dialog"
        aria-expanded={nowly.expanded ?? false}
        {...(nowly.onNudge ? { 'aria-keyshortcuts': 'ArrowLeft ArrowRight' } : {})}
        {...surfaceHandlers(nowly)}
      >
        <img src="/logo.png" alt="" />
      </button>
    </div>
  );
}

/** The Nowly sheet's body. Deliberately a placeholder until its content is decided. */
export function NowlyPanel() {
  const { t } = useTranslation();
  return (
    <section className="status-island__details" data-panel="nowly" data-compact="true" aria-label={t('statusIsland.nowly')}>
      <div className="status-island__panel-body">
        <p className="status-island__empty">{t('statusIsland.nowlyPlaceholder')}</p>
      </div>
    </section>
  );
}

type PanelActions = {
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTask: (id: string) => void;
  onStartFocus: () => void;
  onPauseFocus: () => void;
  onResumeFocus: () => void;
  onEndFocus: () => void;
  onCompleteTask: (id: string) => void;
  onRetryStatus?: () => void;
};

function EventRow({ event, onOpenEvent, t }: { event: CalendarEvent; onOpenEvent: (event: CalendarEvent) => void; t: Translate }) {
  return (
    <button
      className="status-island__row"
      type="button"
      aria-label={t('statusIsland.openEvent', { title: event.title })}
      onClick={() => onOpenEvent(event)}
    >
      <CalendarDays aria-hidden="true" />
      <span>
        <small>{event.allDay ? t('statusIsland.allDayEvent') : t('statusIsland.eventStartsAt', { time: formatTime(event.startAt) })}</small>
        <strong>{event.title}</strong>
      </span>
      {/* An all-day event has no meaningful clock time; the label above already
          says so, and repeating it would read twice to a screen reader. */}
      {event.allDay ? null : <time dateTime={event.startAt}>{formatTime(event.startAt)}</time>}
    </button>
  );
}

function TaskRow({ task, onOpenTask, t }: { task: Task; onOpenTask: (id: string) => void; t: Translate }) {
  return (
    <button
      className="status-island__row"
      type="button"
      aria-label={t('statusIsland.openTask', { title: task.title })}
      onClick={() => onOpenTask(task.id)}
    >
      <CircleAlert aria-hidden="true" />
      <span>
        <small>{task.priority === 'important_urgent' ? t('statusIsland.taskMeta') : t('statusIsland.importantTask')}</small>
        <strong>{task.title}</strong>
      </span>
      <span>{task.dueDate ?? t('statusIsland.noDueDate')}</span>
    </button>
  );
}

/** One marker's items, listed in full. "重要 2 项" has to open into both of them. */
function OverviewGroup({
  group,
  actions,
  t
}: { group: StatusIslandOverviewGroup; actions: PanelActions; t: Translate }) {
  return (
    <section className="status-island__group" aria-label={markerText(group, t)}>
      <h3 className="status-island__group-title">
        <span className={`status-island__signal is-${group.tone}`}>{group.count}</span>
        {markerText(group, t)}
      </h3>
      {group.events.map(event => (
        <EventRow event={event} onOpenEvent={actions.onOpenEvent} t={t} key={`${event.id}:${event.startAt}`} />
      ))}
      {group.tasks.map(task => (
        <TaskRow task={task} onOpenTask={actions.onOpenTask} t={t} key={task.id} />
      ))}
    </section>
  );
}

function panelTitle(context: StatusIslandPanelContext, t: Translate): string {
  const keys = {
    empty: 'statusIsland.emptyPanel',
    focus: 'statusIsland.focusPanel',
    conflict: 'statusIsland.conflictPanel',
    eventReminder: 'statusIsland.reminderPanel',
    ongoingEvent: 'statusIsland.ongoingPanel',
    urgentTask: 'statusIsland.urgentTaskPanel',
    overview: 'statusIsland.overviewPanel'
  } as const;
  return t(keys[context.kind]);
}

/**
 * The category panel: the rail's sheet content below the head. It keeps a fixed
 * native size, so its content scrolls rather than resizing the window. Every
 * state is expressed with an icon, a title and text, never colour alone.
 *
 * Its own title row is dropped inside the rail, where the head one row above
 * already names what is being shown; the accessible name carries it regardless.
 */
export function StatusIslandPanel({
  context,
  actions,
  compact
}: { context: StatusIslandPanelContext; actions: PanelActions; compact?: boolean }) {
  const { t } = useTranslation();
  const { onRetryStatus } = actions;

  return (
    <section
      className="status-island__details"
      id="status-island-details"
      aria-label={t('statusIsland.details')}
      data-panel={context.kind}
      {...(compact ? { 'data-compact': 'true' } : {})}
    >
      {compact ? null : (
        <header className="status-island__panel-title">
          <strong>{panelTitle(context, t)}</strong>
          <span>{panelSummary(context, t)}</span>
        </header>
      )}
      <div className="status-island__panel-body">{panelBody(context, actions, t)}</div>
      <div className={`status-island__footer${onRetryStatus ? ' has-retry' : ''}`}>
        {onRetryStatus ? (
          <button type="button" className="status-island__retry" aria-label={t('statusIsland.retry')} onClick={onRetryStatus}>
            <RefreshCw aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function panelSummary(context: StatusIslandPanelContext, t: Translate): string {
  if (context.kind === 'focus') return focusStatusText(context.focus, t);
  if (context.kind === 'conflict') return t('statusIsland.markerConflict', { count: context.events.length });
  if (context.kind === 'eventReminder') {
    const lead = context.reminderMinutes === null ? '' : ` · ${t('statusIsland.reminderLead', { minutes: context.reminderMinutes })}`;
    return `${t('statusIsland.eventStartsAt', { time: formatTime(context.event.startAt) })}${lead}`;
  }
  if (context.kind === 'ongoingEvent') return t('statusIsland.eventEndsAt', { time: formatTime(context.event.endAt) });
  if (context.kind === 'urgentTask') {
    return context.task.dueDate ? t('statusIsland.taskDue', { date: context.task.dueDate }) : t('statusIsland.noDueDate');
  }
  if (context.kind === 'overview') {
    return context.totalCount > 0
      ? t('statusIsland.todayTotal', { count: context.totalCount })
      : t('statusIsland.todayClear');
  }
  return t('statusIsland.summary', { events: 0, tasks: 0 });
}

function panelBody(context: StatusIslandPanelContext, actions: PanelActions, t: Translate) {
  if (context.kind === 'focus') {
    const focus = context.focus;
    return (
      <>
        <div className="status-island__row status-island__focus-row">
          <Timer aria-hidden="true" />
          <span><small>{t('statusIsland.focus')}</small><strong>{formatCountdown(focus.remainingSeconds)}</strong></span>
          {/* No second progressbar here. The head one row above carries the role
              and is visible at both sizes, so repeating it would announce the
              same session twice to a screen reader. */}
        </div>
        <div className="status-island__actions">
          {focus.status === 'running' ? (
            <button type="button" onClick={actions.onPauseFocus}><Pause aria-hidden="true" />{t('statusIsland.pauseFocus')}</button>
          ) : null}
          {focus.status === 'paused' ? (
            <button type="button" onClick={actions.onResumeFocus}><Play aria-hidden="true" />{t('statusIsland.resumeFocus')}</button>
          ) : null}
          {focus.status === 'completed' ? (
            <button type="button" onClick={actions.onStartFocus}><Play aria-hidden="true" />{t('statusIsland.startFocus')}</button>
          ) : (
            <button type="button" onClick={actions.onEndFocus}><Square aria-hidden="true" />{t('statusIsland.endFocus')}</button>
          )}
        </div>
      </>
    );
  }
  if (context.kind === 'conflict') {
    return <>{context.events.map(event => <EventRow event={event} onOpenEvent={actions.onOpenEvent} t={t} key={`${event.id}:${event.startAt}`} />)}</>;
  }
  if (context.kind === 'eventReminder' || context.kind === 'ongoingEvent') {
    const event = context.event;
    const elapsed = context.kind === 'ongoingEvent' ? eventElapsedPercent(event) : null;
    return (
      <>
        <EventRow event={event} onOpenEvent={actions.onOpenEvent} t={t} />
        {elapsed === null ? null : (
          <p className="status-island__empty">{t('statusIsland.eventElapsed', { percent: elapsed })}</p>
        )}
        {event.note ? (
          <p className="status-island__empty"><strong>{t('statusIsland.eventNote')}</strong> {event.note}</p>
        ) : null}
      </>
    );
  }
  if (context.kind === 'urgentTask') {
    return (
      <>
        <TaskRow task={context.task} onOpenTask={actions.onOpenTask} t={t} />
        <div className="status-island__actions">
          <button type="button" onClick={() => actions.onCompleteTask(context.task.id)}>
            <Check aria-hidden="true" />{t('statusIsland.completeTask')}
          </button>
        </div>
      </>
    );
  }
  if (context.kind === 'overview') {
    // Grouped and uncapped. An earlier version sliced two events and two tasks,
    // so opening a summary that said "重要 2 项" could show only one of them.
    return (
      <>
        {context.groups.map(group => <OverviewGroup group={group} actions={actions} t={t} key={group.kind} />)}
        {context.groups.length === 0 ? <p className="status-island__empty">{t('statusIsland.todayClear')}</p> : null}
      </>
    );
  }
  return (
    <>
      <p className="status-island__empty">{t('statusIsland.noEvent')}</p>
      <div className="status-island__actions">
        <button type="button" onClick={actions.onStartFocus}><Play aria-hidden="true" />{t('statusIsland.startFocus')}</button>
      </div>
    </>
  );
}

function eventElapsedPercent(event: CalendarEvent): number | null {
  const start = new Date(event.startAt).getTime();
  const end = new Date(event.endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(0, Math.min(100, Math.round(((Date.now() - start) / (end - start)) * 100)));
}

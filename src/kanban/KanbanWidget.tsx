import { Plus, Settings, X } from '../components/icons';
import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { laneCardCount } from './kanban-view';
import { KanbanLane } from './KanbanLane';
import { KanbanLaneDialog } from './KanbanLaneDialog';
import { KanbanDoneButton } from './KanbanDoneButton';
import { KanbanDoneDropZone } from './KanbanDoneDropZone';
import { boardDoneEntries } from './kanban-done';
import type { KanbanLaneDraft } from './kanban-model';
import { useWorkspaceKanban } from '../tasks/useWorkspaceKanban';
import { useTaskWorkspace } from '../tasks/TaskWorkspaceContext';
import { useTaskDrag } from '../tasks/TaskDragContext';
import { UnifiedTaskDialog } from '../tasks/UnifiedTaskDialog';
import { TaskSettingsDialog } from '../tasks/TaskSettingsDialog';
import { defaultTaskPriority } from '../tasks/task-model';
import { priorityColors } from '../tasks/task-projections';
import { celebrateTaskCompletion, prefersReducedMotion } from '../tasks/completion-celebration';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FilterSelect, type FilterOption } from '../components/FilterSelect';
import { t } from '../i18n';

// Drag payloads carried in component state (dataTransfer is unreliable in the
// WebView for structured data, and we keep everything static per the design).
// Matrix tasks dragged onto the board arrive through TaskDragContext instead.
type Drag =
  | { kind: 'card'; cardId: string }
  | { kind: 'lane'; laneId: string }
  | null;

type DropTarget =
  | { kind: 'lane'; laneId: string; visibleIndex: number }
  | { kind: 'done' }
  | null;

function sameTarget(a: DropTarget, b: DropTarget) {
  if (a === null || b === null) return a === b;
  if (a.kind === 'done' || b.kind === 'done') return a.kind === b.kind;
  return a.laneId === b.laneId && a.visibleIndex === b.visibleIndex;
}

type DialogState =
  // `afterLaneId` places the new lane to the right of that lane.
  | { type: 'lane-create'; afterLaneId: string | null }
  | { type: 'lane-edit'; laneId: string }
  | { type: 'lane-delete'; laneId: string }
  | { type: 'card-create' }
  | { type: 'card-edit'; cardId: string }
  | { type: 'fields' }
  | null;

type KanbanWidgetProps = {
  todayIso: string;
  recentColors?: string[];
  onRememberCustomColor?: (color: string) => Promise<void> | void;
};

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('common.opFailed');
}

export function KanbanWidget({
  todayIso,
  recentColors = [],
  onRememberCustomColor
}: KanbanWidgetProps) {
  const kanban = useWorkspaceKanban();
  const workspace = useTaskWorkspace();
  const { snapshot, dragError } = kanban;
  const data = snapshot.data;
  const { defaultLaneId } = workspace.workspace.data;
  const [dialog, setDialog] = useState<DialogState>(null);
  const taskDrag = useTaskDrag();
  const [drag, setDrag] = useState<Drag>(null);
  const [dropTarget, setDropTargetState] = useState<DropTarget>(null);
  const [zoneConfirmation, setZoneConfirmation] = useState<{ title: string; solid: boolean } | null>(null);
  const zoneTimerRef = useRef(0);
  const [filterTag, setFilterTag] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Only offer tags that exist on the current board, and reset a selection to
  // "show all" once it no longer matches anything.
  const showAll = t('filter.showAll');
  const tagOptions = useMemo<FilterOption[]>(
    () => [
      { value: '', label: showAll },
      ...data.tags.map((tag) => ({ value: tag.id, label: tag.name, color: tag.color }))
    ],
    [data.tags, showAll]
  );
  const effectiveTag = data.tags.some((tag) => tag.id === filterTag) ? filterTag : '';

  function matchesFilter(card: { tagIds: string[] }): boolean {
    return !effectiveTag || card.tagIds.includes(effectiveTag);
  }

  const status = snapshot.status;
  const errorMessage = status === 'error' ? snapshot.message : undefined;

  function openDialog(next: DialogState, trigger: HTMLElement | null) {
    restoreFocusRef.current = trigger;
    setDialog(next);
  }

  function addTask(laneId: string, title: string) {
    return workspace.createTask({
      title,
      description: '',
      priority: defaultTaskPriority,
      dueDate: null,
      completed: false,
      laneId,
      tagIds: []
    });
  }

  async function createLane(draft: KanbanLaneDraft, afterLaneId: string | null) {
    const lane = await kanban.createLane(draft);
    if (!afterLaneId || !lane) return;
    const order = data.lanes.map((item) => item.id).filter((id) => id !== lane.id);
    const index = order.indexOf(afterLaneId);
    if (index < 0 || index === order.length - 1) return;
    order.splice(index + 1, 0, lane.id);
    await kanban.reorderLanes(order);
  }

  async function deleteLane(laneId: string) {
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await kanban.deleteLane(laneId);
      setDialog(null);
    } catch (error) {
      setDeleteError(messageFrom(error));
    } finally {
      setDeleteBusy(false);
    }
  }

  // ----- drag and drop --------------------------------------------------------
  // A board card or an open matrix task can be dropped into a lane.
  const draggingTaskId = drag?.kind === 'card' ? drag.cardId : drag ? null : taskDrag.matrixTaskId;
  const doneEntries = useMemo(() => boardDoneEntries(workspace.workspace.data), [workspace.workspace.data]);
  const hasLanes = status !== 'loading' && data.lanes.length > 0;

  useEffect(() => () => window.clearTimeout(zoneTimerRef.current), []);

  function setDropTarget(next: DropTarget) {
    setDropTargetState((current) => sameTarget(current, next) ? current : next);
  }

  function setDataTransfer(event: DragEvent<HTMLElement>, id: string) {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  }

  function onCardDragStart(event: DragEvent<HTMLElement>, cardId: string) {
    setDataTransfer(event, cardId);
    setDrag({ kind: 'card', cardId });
  }

  function onLaneDragStart(event: DragEvent<HTMLElement>, laneId: string) {
    setDataTransfer(event, laneId);
    setDrag({ kind: 'lane', laneId });
  }

  // The dragged node may be unmounted by the drop's re-render and never fire
  // `dragend`, so drops clean up through here as well.
  function onDragEnd() {
    setDrag(null);
    setDropTarget(null);
    taskDrag.endMatrixDrag();
  }

  function onLaneDragOver(event: DragEvent<HTMLElement>, laneId: string, visibleIndex: number) {
    if (drag?.kind === 'lane') {
      event.preventDefault();
      return;
    }
    if (!draggingTaskId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setDropTarget({ kind: 'lane', laneId, visibleIndex });
  }

  function onLaneDrop(event: DragEvent<HTMLElement>, laneId: string, index: number) {
    event.preventDefault();
    if (drag?.kind === 'lane') {
      onLaneDropReorder(laneId);
      return;
    }
    if (draggingTaskId) void kanban.moveCard(draggingTaskId, laneId, index);
    onDragEnd();
  }

  function onBodyDragOver(event: DragEvent<HTMLElement>) {
    const target = event.target as Element;
    if (!target.closest?.('.kanban-lane, .kanban-done-drop')) setDropTarget(null);
  }

  function onDoneDragOver(event: DragEvent<HTMLElement>) {
    if (drag?.kind !== 'card') return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setDropTarget({ kind: 'done' });
  }

  function onDoneDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const cardId = drag?.kind === 'card' ? drag.cardId : null;
    onDragEnd();
    const task = cardId ? workspace.workspace.data.tasks.find((item) => item.id === cardId) : undefined;
    if (!task) return;
    // Keep the zone up while the stamp plays (or the reduced-motion message shows).
    const solid = prefersReducedMotion();
    window.clearTimeout(zoneTimerRef.current);
    setZoneConfirmation({ title: task.title, solid });
    zoneTimerRef.current = window.setTimeout(() => setZoneConfirmation(null), solid ? 700 : 260);
    celebrateTaskCompletion({
      title: task.title,
      color: priorityColors[task.priority],
      dropPoint: { x: event.clientX, y: event.clientY },
      announcement: t('kanbanDone.dropped', { title: task.title })
    });
    void kanban.completeCard(task.id);
  }

  function onLaneDropReorder(targetLaneId: string) {
    if (drag?.kind !== 'lane') return;
    const sourceIndex = data.lanes.findIndex((lane) => lane.id === drag.laneId);
    const targetIndex = data.lanes.findIndex((lane) => lane.id === targetLaneId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
      onDragEnd();
      return;
    }
    const order = data.lanes.map((lane) => lane.id);
    const [removed] = order.splice(sourceIndex, 1);
    order.splice(targetIndex, 0, removed);
    void kanban.reorderLanes(order);
    onDragEnd();
  }

  // ----- dialog resolution ----------------------------------------------------
  const editingLane =
    dialog?.type === 'lane-edit' ? data.lanes.find((lane) => lane.id === dialog.laneId) ?? null : null;
  const deletingLane =
    dialog?.type === 'lane-delete' ? data.lanes.find((lane) => lane.id === dialog.laneId) ?? null : null;
  const editingTask =
    dialog?.type === 'card-edit' ? workspace.workspace.data.tasks.find((task) => task.id === dialog.cardId) ?? null : null;
  const createLaneId = data.lanes.some((lane) => lane.id === defaultLaneId) ? defaultLaneId : data.lanes[0]?.id ?? null;

  function closeDialog() {
    setDialog(null);
    setDeleteError('');
  }

  return (
    <div className="widget-content kanban-widget">
      <div className="card-header">
        {data.tags.length > 0 ? (
          <nav className="filter-bar" aria-label={t('kanbanWidget.filterLabel')}>
            <FilterSelect
              label={t('kanbanWidget.filterTag')}
              ariaLabel={t('kanbanWidget.filterByTag')}
              options={tagOptions}
              value={effectiveTag}
              onChange={setFilterTag}
            />
          </nav>
        ) : (
          <span />
        )}
        <div className="toolbar-actions">
          {hasLanes ? (
            <KanbanDoneButton
              entries={doneEntries}
              now={new Date()}
              pendingTaskIds={workspace.pendingTaskIds}
              onReopen={(taskId) => void workspace.setTaskCompleted(taskId, false).catch(() => undefined)}
            />
          ) : null}
          <button
            type="button"
            className="btn btn-icon"
            aria-label={t('kanbanWidget.manageTags')}
            title={t('kanbanWidget.manageTags')}
            onClick={(event) => openDialog({ type: 'fields' }, event.currentTarget)}
          >
            <Settings aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-primary"
            aria-label={t('kanbanWidget.newTask')}
            title={t('kanbanWidget.newTask')}
            disabled={!createLaneId}
            onClick={(event) => openDialog({ type: 'card-create' }, event.currentTarget)}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="panel-body kanban-body" onDragOver={draggingTaskId ? onBodyDragOver : undefined}>
        {status === 'error' ? (
          <div className="module-message" role="alert">
            <span>{errorMessage ?? t('kanbanWidget.errorLoad')}</span>
            <button type="button" className="link-btn" aria-label={t('kanbanWidget.retryLoad')} onClick={() => void kanban.retry()}>
              {t('common.retry')}
            </button>
          </div>
        ) : null}
        {dragError ? (
          <div className="module-message" role="alert">
            <span>{dragError}</span>
            <button type="button" className="btn btn-icon module-message__close" aria-label={t('kanbanWidget.dismissDragError')} title={t('common.close')} onClick={kanban.dismissDragError}>
              <X aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {status === 'loading' ? <p className="empty-copy">{t('kanbanWidget.loading')}</p> : null}

        {status !== 'loading' && data.lanes.length === 0 ? (
          <div className="empty-state">
            <p>{t('kanbanWidget.empty')}</p>
            <button
              type="button"
              className="good-button good-button--primary"
              onClick={(event) => openDialog({ type: 'lane-create', afterLaneId: null }, event.currentTarget)}
            >
              {t('kanbanWidget.addLane')}
            </button>
          </div>
        ) : (
          <div className="kanban-scroll" data-testid="kanban-scroll">
            <div className={`kanban-lanes${draggingTaskId ? ' kanban-lanes--receiving' : ''}`}>
              {data.lanes.map((lane) => {
                const target = dropTarget?.kind === 'lane' && dropTarget.laneId === lane.id ? dropTarget : null;
                return (
                  <KanbanLane
                    key={lane.id}
                    lane={lane}
                    snapshot={data}
                    todayIso={todayIso}
                    isDropTarget={target !== null}
                    draggingTaskId={draggingTaskId}
                    dropIndex={target?.visibleIndex ?? null}
                    onAddTask={(title) => addTask(lane.id, title)}
                    onEditLane={(trigger) => openDialog({ type: 'lane-edit', laneId: lane.id }, trigger)}
                    onAddLaneRight={(trigger) => openDialog({ type: 'lane-create', afterLaneId: lane.id }, trigger)}
                    onDeleteLane={(trigger) => openDialog({ type: 'lane-delete', laneId: lane.id }, trigger)}
                    onOpenCard={(cardId, trigger) => openDialog({ type: 'card-edit', cardId }, trigger)}
                    onLaneDragStart={(event) => onLaneDragStart(event, lane.id)}
                    onLaneDragEnd={onDragEnd}
                    onLaneDragOver={(event, visibleIndex) => onLaneDragOver(event, lane.id, visibleIndex)}
                    onLaneDrop={(event, index) => onLaneDrop(event, lane.id, index)}
                    onCardDragStart={onCardDragStart}
                    onCardDragEnd={onDragEnd}
                    matchesFilter={matchesFilter}
                  />
                );
              })}
            </div>
          </div>
        )}
        {hasLanes && (drag?.kind === 'card' || zoneConfirmation) ? (
          <KanbanDoneDropZone
            active={dropTarget?.kind === 'done'}
            confirmation={zoneConfirmation}
            onDragOver={onDoneDragOver}
            onDragLeave={() => setDropTarget(null)}
            onDrop={onDoneDrop}
          />
        ) : null}
      </div>

      {dialog?.type === 'lane-create' ? (
        <KanbanLaneDialog
          mode={{ type: 'create' }}
          restoreFocusRef={restoreFocusRef}
          onClose={closeDialog}
          onCreate={(draft) => createLane(draft, dialog.afterLaneId)}
          onUpdate={(lane, draft) => kanban.updateLane(lane.id, draft)}
          recentColors={recentColors}
          onRememberCustomColor={onRememberCustomColor}
        />
      ) : null}
      {editingLane ? (
        <KanbanLaneDialog
          mode={{ type: 'edit', lane: editingLane }}
          restoreFocusRef={restoreFocusRef}
          onClose={closeDialog}
          onCreate={(draft) => createLane(draft, null)}
          onUpdate={(lane, draft) => kanban.updateLane(lane.id, draft)}
          recentColors={recentColors}
          onRememberCustomColor={onRememberCustomColor}
        />
      ) : null}
      {deletingLane ? (
        <ConfirmDialog
          title={t('kanbanLaneDialog.deleteTitle', { name: deletingLane.name })}
          description={
            laneCardCount(data, deletingLane.id) > 0
              ? t('kanbanLaneDialog.deleteWithCards', { count: laneCardCount(data, deletingLane.id) })
              : t('kanbanLaneDialog.deleteEmpty')
          }
          tone="danger"
          confirmLabel={t('common.permanentDelete')}
          busyLabel={t('common.deleting')}
          busy={deleteBusy}
          errorMessage={deleteError}
          restoreFocusRef={restoreFocusRef}
          onCancel={closeDialog}
          onConfirm={() => void deleteLane(deletingLane.id)}
        />
      ) : null}
      {dialog?.type === 'card-create' && createLaneId ? (
        <UnifiedTaskDialog
          mode={{ type: 'create', dueDate: null, laneId: createLaneId }}
          restoreFocusRef={restoreFocusRef}
          onClose={closeDialog}
        />
      ) : null}
      {editingTask ? (
        <UnifiedTaskDialog
          mode={{ type: 'edit', task: editingTask }}
          restoreFocusRef={restoreFocusRef}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.type === 'fields' ? (
        <TaskSettingsDialog
          restoreFocusRef={restoreFocusRef}
          onClose={closeDialog}
          recentColors={recentColors}
          onRememberCustomColor={onRememberCustomColor}
        />
      ) : null}
    </div>
  );
}
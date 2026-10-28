import { Plus, Settings, X } from '../components/icons';
import { type DragEvent, useMemo, useRef, useState } from 'react';
import { laneCardCount } from './kanban-view';
import { KanbanLane } from './KanbanLane';
import { KanbanLaneDialog } from './KanbanLaneDialog';
import type { KanbanLaneDraft } from './kanban-model';
import { useWorkspaceKanban } from '../tasks/useWorkspaceKanban';
import { useTaskWorkspace } from '../tasks/TaskWorkspaceContext';
import { UnifiedTaskDialog } from '../tasks/UnifiedTaskDialog';
import { TaskSettingsDialog } from '../tasks/TaskSettingsDialog';
import { defaultTaskPriority } from '../tasks/task-model';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FilterSelect, type FilterOption } from '../components/FilterSelect';
import { t } from '../i18n';

// Drag payloads carried in component state (dataTransfer is unreliable in the
// WebView for structured data, and we keep everything static per the design).
type Drag =
  | { kind: 'card'; cardId: string }
  | { kind: 'lane'; laneId: string }
  | null;

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
  const { defaultLaneId, completionLaneId } = workspace.workspace.data;
  const [dialog, setDialog] = useState<DialogState>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [dropLaneId, setDropLaneId] = useState<string | null>(null);
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
      completed: laneId === completionLaneId,
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
  function onCardDragStart(event: DragEvent<HTMLElement>, cardId: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', cardId);
    setDrag({ kind: 'card', cardId });
  }

  function onLaneDragStart(event: DragEvent<HTMLElement>, laneId: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', laneId);
    setDrag({ kind: 'lane', laneId });
  }

  function onDragEnd() {
    setDrag(null);
    setDropLaneId(null);
  }

  function onLaneDragOver(event: DragEvent<HTMLElement>, laneId: string) {
    if (!drag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (drag.kind === 'card') setDropLaneId(laneId);
  }

  function onCardDropInLane(laneId: string, index: number) {
    if (drag?.kind !== 'card') return;
    void kanban.moveCard(drag.cardId, laneId, index);
    onDragEnd();
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

      <div className="panel-body kanban-body">
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
            <div className="kanban-lanes">
              {data.lanes.map((lane) => (
                <KanbanLane
                  key={lane.id}
                  lane={lane}
                  snapshot={data}
                  todayIso={todayIso}
                  isDropTarget={drag?.kind === 'card' && dropLaneId === lane.id}
                  isCompletionLane={lane.id === completionLaneId}
                  onAddTask={(title) => addTask(lane.id, title)}
                  onEditLane={(trigger) => openDialog({ type: 'lane-edit', laneId: lane.id }, trigger)}
                  onAddLaneRight={(trigger) => openDialog({ type: 'lane-create', afterLaneId: lane.id }, trigger)}
                  onDeleteLane={data.lanes.length > 1
                    ? (trigger) => openDialog({ type: 'lane-delete', laneId: lane.id }, trigger)
                    : undefined}
                  onOpenCard={(cardId, trigger) => openDialog({ type: 'card-edit', cardId }, trigger)}
                  onLaneDragStart={(event) => onLaneDragStart(event, lane.id)}
                  onLaneDragEnd={onDragEnd}
                  onLaneDragOver={(event) => {
                    onLaneDragOver(event, lane.id);
                    if (drag?.kind === 'lane') event.preventDefault();
                  }}
                  onLaneDrop={(event, cardIndex) => {
                    event.preventDefault();
                    if (drag?.kind === 'lane') onLaneDropReorder(lane.id);
                    else onCardDropInLane(lane.id, cardIndex);
                  }}
                  onCardDragStart={onCardDragStart}
                  onCardDragEnd={onDragEnd}
                  matchesFilter={matchesFilter}
                />
              ))}
            </div>
          </div>
        )}
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
              ? t('kanbanLaneDialog.deleteWithCards', {
                count: laneCardCount(data, deletingLane.id),
                target: data.lanes.find((lane) => lane.id !== deletingLane.id)?.name ?? ''
              })
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
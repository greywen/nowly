import { Pencil, Trash2, X } from 'lucide-react';
import { ColorPicker } from '../components/ColorPicker';
import type { HexColor } from '../lib/color';
import { type RefObject, useId, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { colorStyle, isPresetColor } from '../lib/color';
import { collaboratorUsage, priorityUsage, tagUsage } from './kanban-view';
import { DEFAULT_KANBAN_COLOR, kanbanColorPresets } from './kanban-model';
import { t } from '../i18n';
import type {
  KanbanCollaborator,
  KanbanCollaboratorDraft,
  KanbanColor,
  KanbanPriority,
  KanbanPriorityDraft,
  KanbanSnapshot,
  KanbanTag,
  KanbanTagDraft
} from './kanban-model';

type FieldTab = 'priorities' | 'tags' | 'collaborators';

type KanbanFieldManagerDialogProps = {
  snapshot: KanbanSnapshot;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  createPriority(draft: KanbanPriorityDraft): Promise<KanbanPriority>;
  updatePriority(id: string, draft: KanbanPriorityDraft): Promise<KanbanPriority>;
  deletePriority(id: string): Promise<void>;
  reorderPriorities(orderedIds: string[]): Promise<KanbanPriority[]>;
  createTag(draft: KanbanTagDraft): Promise<KanbanTag>;
  updateTag(id: string, draft: KanbanTagDraft): Promise<KanbanTag>;
  deleteTag(id: string): Promise<void>;
  createCollaborator(draft: KanbanCollaboratorDraft): Promise<KanbanCollaborator>;
  updateCollaborator(id: string, draft: KanbanCollaboratorDraft): Promise<KanbanCollaborator>;
  deleteCollaborator(id: string): Promise<void>;
  recentColors?: HexColor[];
  onRememberCustomColor?: (color: HexColor) => Promise<void> | void;
};

function errorMessage(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('common.opFailed');
}

type ColoredItem = { id: string; name: string; color: KanbanColor };
type PlainItem = { id: string; name: string };

export function KanbanFieldManagerDialog({
  snapshot,
  restoreFocusRef,
  onClose,
  createPriority,
  updatePriority,
  deletePriority,
  reorderPriorities,
  createTag,
  updateTag,
  deleteTag,
  createCollaborator,
  updateCollaborator,
  deleteCollaborator,
  recentColors = [],
  onRememberCustomColor
}: KanbanFieldManagerDialogProps) {
  const titleId = useId();
  const [tab, setTab] = useState<FieldTab>('priorities');
  const [name, setName] = useState('');
  const [color, setColor] = useState<KanbanColor>(DEFAULT_KANBAN_COLOR);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; usage: number } | null>(null);

  const hasColor = tab !== 'collaborators';

  function resetForm() {
    setName('');
    setColor(DEFAULT_KANBAN_COLOR);
    setEditingId(null);
    setFormError('');
  }

  function switchTab(next: FieldTab) {
    setTab(next);
    resetForm();
  }

  function beginEdit(item: ColoredItem | PlainItem) {
    setEditingId(item.id);
    setName(item.name);
    if ('color' in item) setColor(item.color);
    setFormError('');
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError(t('kanbanField.errorName'));
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      if (tab === 'priorities') {
        if (editingId) await updatePriority(editingId, { name: trimmed, color });
        else await createPriority({ name: trimmed, color });
      } else if (tab === 'tags') {
        if (editingId) await updateTag(editingId, { name: trimmed, color });
        else await createTag({ name: trimmed, color });
      } else {
        if (editingId) await updateCollaborator(editingId, { name: trimmed });
        else await createCollaborator({ name: trimmed });
      }
      if (tab !== 'collaborators' && onRememberCustomColor && !isPresetColor(color, kanbanColorPresets())) await onRememberCustomColor(color);
      resetForm();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoval() {
    if (!confirmDelete) return;
    setBusy(true);
    setFormError('');
    try {
      if (tab === 'priorities') await deletePriority(confirmDelete.id);
      else if (tab === 'tags') await deleteTag(confirmDelete.id);
      else await deleteCollaborator(confirmDelete.id);
      if (editingId === confirmDelete.id) resetForm();
      setConfirmDelete(null);
    } catch (error) {
      setFormError(errorMessage(error));
      setConfirmDelete(null);
    } finally {
      setBusy(false);
    }
  }

  async function move(id: string, delta: number) {
    const ids = snapshot.priorities.map((item) => item.id);
    const index = ids.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const next = [...ids];
    const [removed] = next.splice(index, 1);
    next.splice(target, 0, removed);
    setBusy(true);
    try {
      await reorderPriorities(next);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => {
    if (tab === 'priorities') {
      return snapshot.priorities.map((item) => ({
        id: item.id,
        name: item.name,
        color: item.color,
        usage: priorityUsage(snapshot, item.id)
      }));
    }
    if (tab === 'tags') {
      return snapshot.tags.map((item) => ({
        id: item.id,
        name: item.name,
        color: item.color,
        usage: tagUsage(snapshot, item.id)
      }));
    }
    return snapshot.collaborators.map((item) => ({
      id: item.id,
      name: item.name,
      color: undefined,
      usage: collaboratorUsage(snapshot, item.id)
    }));
  }, [snapshot, tab]);

  const tabLabels: Record<FieldTab, string> = {
    priorities: t('kanbanField.priorities'),
    tags: t('kanbanField.tags'),
    collaborators: t('kanbanField.collaborators')
  };

  const deleteImpact = (usage: number) =>
    tab === 'priorities'
      ? t('kanbanField.deletePriorityImpact', { count: usage })
      : tab === 'tags'
        ? t('kanbanField.deleteTagImpact', { count: usage })
        : t('kanbanField.deleteCollaboratorImpact', { count: usage });

  return (
    <>
      <Dialog
        title={t('kanbanField.title')}
        ariaLabelledBy={titleId}
        isTopLayer={!confirmDelete}
        restoreFocusRef={restoreFocusRef}
        onRequestClose={busy ? () => undefined : onClose}
        className="kanban-field-dialog"
        headerActions={
          <button type="button" aria-label={t('kanbanField.close')} className="good-icon-button" disabled={busy} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        }
      >
        <div className="kanban-field" role="tablist" aria-label={t('kanbanField.fieldType')}>
          {(['priorities', 'tags', 'collaborators'] as FieldTab[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`kanban-field__tab${tab === key ? ' is-active' : ''}`}
              onClick={() => switchTab(key)}
            >
              {tabLabels[key]}
            </button>
          ))}
        </div>

        <form
          className="kanban-field__form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="good-field">
            <label htmlFor="kanban-field-name">{editingId ? t('kanbanField.edit', { label: tabLabels[tab] }) : t('kanbanField.add', { label: tabLabels[tab] })}</label>
            <input
              id="kanban-field-name"
              className="good-input"
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {hasColor ? (
            <ColorPicker legend={t('kanbanField.color')} name="kanban-field-color" value={color} presets={kanbanColorPresets()} recentColors={recentColors} disabled={busy} onChange={setColor} onRememberColor={onRememberCustomColor} />
          ) : null}
          {formError ? <div role="alert" className="dialog-error">{formError}</div> : null}
          <div className="kanban-field__form-actions">
            {editingId ? (
              <button type="button" className="good-button" disabled={busy} onClick={resetForm}>
                {t('kanbanField.cancelEdit')}
              </button>
            ) : null}
            <button type="submit" className="good-button good-button--primary" disabled={busy}>
              {editingId ? t('kanbanField.saveEdit') : t('kanbanField.addAction', { label: tabLabels[tab] })}
            </button>
          </div>
        </form>

        <ul className="kanban-field__list" aria-label={t('kanbanField.list', { label: tabLabels[tab] })}>
          {rows.length === 0 ? (
            <li className="kanban-field__empty">{t('kanbanField.empty', { label: tabLabels[tab] })}</li>
          ) : (
            rows.map((row, index) => (
              <li key={row.id} className="kanban-field__row">
                {row.color ? (
                  <span
                    className="kanban-badge"
                    style={colorStyle(row.color)}
                    aria-hidden="true"
                  >
                    {row.name}
                  </span>
                ) : (
                  <span className="kanban-field__name">{row.name}</span>
                )}
                <span className="kanban-field__usage">{t('kanbanField.usage', { count: row.usage })}</span>
                <span className="kanban-field__tools">
                  {tab === 'priorities' ? (
                    <>
                      <button
                        type="button"
                        className="good-icon-button"
                        aria-label={t('kanbanField.moveUp', { name: row.name })}
                        disabled={busy || index === 0}
                        onClick={() => void move(row.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="good-icon-button"
                        aria-label={t('kanbanField.moveDown', { name: row.name })}
                        disabled={busy || index === rows.length - 1}
                        onClick={() => void move(row.id, 1)}
                      >
                        ↓
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="good-icon-button"
                    aria-label={t('kanbanField.editItem', { name: row.name })}
                    disabled={busy}
                    onClick={() => beginEdit(row.color ? { id: row.id, name: row.name, color: row.color } : { id: row.id, name: row.name })}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="good-icon-button"
                    aria-label={t('kanbanField.deleteItem', { name: row.name })}
                    disabled={busy}
                    onClick={() => setConfirmDelete({ id: row.id, name: row.name, usage: row.usage })}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))
          )}
        </ul>
      </Dialog>

      {confirmDelete ? (
        <ConfirmDialog
          title={t('kanbanField.deleteTitle', { name: confirmDelete.name })}
          description={deleteImpact(confirmDelete.usage)}
          tone="danger"
          confirmLabel={t('common.delete')}
          busyLabel={t('common.deleting')}
          busy={busy}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void confirmRemoval()}
        />
      ) : null}
    </>
  );
}

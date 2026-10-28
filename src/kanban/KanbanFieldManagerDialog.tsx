import { Pencil, Trash2, X } from '../components/icons';
import { ColorPicker } from '../components/ColorPicker';
import type { HexColor } from '../lib/color';
import { type RefObject, useId, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { colorStyle, isPresetColor } from '../lib/color';
import { tagUsage } from './kanban-view';
import { DEFAULT_KANBAN_COLOR, kanbanColorPresets } from './kanban-model';
import { t } from '../i18n';
import type { KanbanColor, KanbanSnapshot, KanbanTagDraft } from './kanban-model';

type KanbanFieldManagerDialogProps = {
  snapshot: KanbanSnapshot;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  createTag(draft: KanbanTagDraft): Promise<unknown>;
  updateTag(id: string, draft: KanbanTagDraft): Promise<unknown>;
  deleteTag(id: string): Promise<unknown>;
  recentColors?: HexColor[];
  onRememberCustomColor?: (color: HexColor) => Promise<void> | void;
};

function errorMessage(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('common.opFailed');
}

type ColoredItem = { id: string; name: string; color: KanbanColor };

export function KanbanFieldManagerDialog({
  snapshot,
  restoreFocusRef,
  onClose,
  createTag,
  updateTag,
  deleteTag,
  recentColors = [],
  onRememberCustomColor
}: KanbanFieldManagerDialogProps) {
  const titleId = useId();
  const [name, setName] = useState('');
  const [color, setColor] = useState<KanbanColor>(DEFAULT_KANBAN_COLOR);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; usage: number } | null>(null);

  function resetForm() {
    setName('');
    setColor(DEFAULT_KANBAN_COLOR);
    setEditingId(null);
    setFormError('');
  }

  function beginEdit(item: ColoredItem) {
    setEditingId(item.id);
    setName(item.name);
    setColor(item.color);
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
      if (editingId) await updateTag(editingId, { name: trimmed, color });
      else await createTag({ name: trimmed, color });
      if (onRememberCustomColor && !isPresetColor(color, kanbanColorPresets())) await onRememberCustomColor(color);
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
      await deleteTag(confirmDelete.id);
      if (editingId === confirmDelete.id) resetForm();
      setConfirmDelete(null);
    } catch (error) {
      setFormError(errorMessage(error));
      setConfirmDelete(null);
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(
    () => snapshot.tags.map((item) => ({
      id: item.id,
      name: item.name,
      color: item.color,
      usage: tagUsage(snapshot, item.id)
    })),
    [snapshot]
  );
  const label = t('kanbanField.tags');

  return (
    <>
      <Dialog
        title={t('taskSettings.title')}
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
        <div className="kanban-field">
          <div className="kanban-field__panel">
            <form
                className="kanban-field__form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <div className="good-field">
                  <label htmlFor="kanban-field-name">{editingId ? t('kanbanField.edit', { label }) : t('kanbanField.add', { label })}</label>
                  <input
                    id="kanban-field-name"
                    className="good-input"
                    autoComplete="off"
                    value={name}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <ColorPicker legend={t('kanbanField.color')} name="kanban-field-color" value={color} presets={kanbanColorPresets()} recentColors={recentColors} disabled={busy} onChange={setColor} onRememberColor={onRememberCustomColor} />
                {formError ? <div role="alert" className="dialog-error">{formError}</div> : null}
                <div className="kanban-field__form-actions">
                  {editingId ? (
                    <button type="button" className="good-button" disabled={busy} onClick={resetForm}>
                      {t('kanbanField.cancelEdit')}
                    </button>
                  ) : null}
                  <button type="submit" className="good-button good-button--primary" disabled={busy}>
                    {editingId ? t('kanbanField.saveEdit') : t('kanbanField.addAction', { label })}
                  </button>
                </div>
            </form>

            <ul className="kanban-field__list" aria-label={t('kanbanField.list', { label })}>
                {rows.length === 0 ? (
                  <li className="kanban-field__empty">{t('kanbanField.empty', { label })}</li>
                ) : (
                  rows.map((row) => (
                    <li key={row.id} className="kanban-field__row">
                      <span className="kanban-badge" style={colorStyle(row.color)} aria-hidden="true">
                        {row.name}
                      </span>
                      <span className="kanban-field__usage">{t('kanbanField.usage', { count: row.usage })}</span>
                        <span className="kanban-field__tools">
                          <button type="button" className="good-icon-button" aria-label={t('kanbanField.editItem', { name: row.name })} disabled={busy} onClick={() => beginEdit(row)}>
                            <Pencil aria-hidden="true" />
                          </button>
                          <button type="button" className="good-icon-button" aria-label={t('kanbanField.deleteItem', { name: row.name })} disabled={busy} onClick={() => setConfirmDelete({ id: row.id, name: row.name, usage: row.usage })}>
                            <Trash2 aria-hidden="true" />
                          </button>
                        </span>
                    </li>
                  ))
                )}
            </ul>
          </div>
        </div>
      </Dialog>

      {confirmDelete ? (
        <ConfirmDialog
          title={t('kanbanField.deleteTitle', { name: confirmDelete.name })}
          description={t('kanbanField.deleteTagImpact', { count: confirmDelete.usage })}
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

import { Pencil, Trash2, X } from 'lucide-react';
import { ColorPicker } from '../components/ColorPicker';
import type { HexColor } from '../lib/color';
import { type RefObject, useId, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { TabPanel, Tabs, type TabItem } from '../components/Tabs';
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

type FieldTab = 'linking' | 'priorities' | 'tags' | 'collaborators';

type KanbanFieldManagerDialogProps = {
  snapshot: KanbanSnapshot;
  linkingEnabled?: boolean;
  onSetLinking?: (enabled: boolean) => Promise<unknown>;
  fixedPrioritiesReadOnly?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  createPriority(draft: KanbanPriorityDraft): Promise<unknown>;
  updatePriority(id: string, draft: KanbanPriorityDraft): Promise<unknown>;
  deletePriority(id: string): Promise<unknown>;
  reorderPriorities(orderedIds: string[]): Promise<unknown>;
  createTag(draft: KanbanTagDraft): Promise<unknown>;
  updateTag(id: string, draft: KanbanTagDraft): Promise<unknown>;
  deleteTag(id: string): Promise<unknown>;
  createCollaborator(draft: KanbanCollaboratorDraft): Promise<unknown>;
  updateCollaborator(id: string, draft: KanbanCollaboratorDraft): Promise<unknown>;
  deleteCollaborator(id: string): Promise<unknown>;
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
  linkingEnabled,
  onSetLinking,
  fixedPrioritiesReadOnly = false,
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
  const [tab, setTab] = useState<FieldTab>(onSetLinking ? 'linking' : 'priorities');
  const [name, setName] = useState('');
  const [color, setColor] = useState<KanbanColor>(DEFAULT_KANBAN_COLOR);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; usage: number } | null>(null);
  const [confirmLinking, setConfirmLinking] = useState(false);

  const hasColor = tab !== 'collaborators';

  async function changeLinking(enabled: boolean) {
    if (!onSetLinking) return;
    if (enabled && linkingEnabled === false) {
      setConfirmLinking(true);
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      await onSetLinking(enabled);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function enableLinking() {
    if (!onSetLinking) return;
    setBusy(true);
    setFormError('');
    try {
      await onSetLinking(true);
      setConfirmLinking(false);
    } catch (error) {
      setFormError(errorMessage(error));
      setConfirmLinking(false);
    } finally {
      setBusy(false);
    }
  }

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
    if (tab === 'linking') return [];
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
    linking: t('taskSettings.linkingTab'),
    priorities: t('kanbanField.priorities'),
    tags: t('kanbanField.tags'),
    collaborators: t('kanbanField.collaborators')
  };

  const tabs: TabItem<FieldTab>[] = [
    ...(onSetLinking ? [{ id: 'linking' as const, label: tabLabels.linking }] : []),
    { id: 'priorities', label: tabLabels.priorities, count: snapshot.priorities.length },
    { id: 'tags', label: tabLabels.tags, count: snapshot.tags.length },
    { id: 'collaborators', label: tabLabels.collaborators, count: snapshot.collaborators.length }
  ];

  const deleteImpact = (usage: number) =>
    tab === 'priorities'
      ? t('kanbanField.deletePriorityImpact', { count: usage })
      : tab === 'tags'
        ? t('kanbanField.deleteTagImpact', { count: usage })
        : t('kanbanField.deleteCollaboratorImpact', { count: usage });

  return (
    <>
      <Dialog
        title={onSetLinking ? t('taskSettings.title') : t('kanbanField.title')}
        ariaLabelledBy={titleId}
        isTopLayer={!confirmDelete && !confirmLinking}
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
          <Tabs
            idPrefix="kanban-field"
            label={t('kanbanField.fieldType')}
            items={tabs}
            value={tab}
            onChange={switchTab}
          />
          <TabPanel idPrefix="kanban-field" tabId={tab} active className="kanban-field__panel">
            {tab === 'linking' ? (
              <div className="task-linking-settings">
                <div>
                  <strong>{t('taskSettings.linkingTitle')}</strong>
                  <p>{t('taskSettings.linkingDescription')}</p>
                </div>
                <label className="form-check form-check-custom form-check-solid">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={linkingEnabled !== false}
                    disabled={busy}
                    onChange={(event) => void changeLinking(event.target.checked)}
                  />
                  <span className="form-check-label">{t('taskSettings.linkingToggle')}</span>
                </label>
                {linkingEnabled === false ? (
                  <p className="task-linking-settings__status">{t('taskSettings.manualModeHint')}</p>
                ) : null}
                {formError ? <div role="alert" className="dialog-error">{formError}</div> : null}
              </div>
            ) : fixedPrioritiesReadOnly && tab === 'priorities' ? (
              <p className="kanban-field__readonly-note">{t('kanbanField.fixedPrioritiesNote')}</p>
            ) : (
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
                    autoComplete="off"
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
            )}

            {tab !== 'linking' ? (
              <ul className="kanban-field__list" aria-label={t('kanbanField.list', { label: tabLabels[tab] })}>
                {rows.length === 0 ? (
                  <li className="kanban-field__empty">{t('kanbanField.empty', { label: tabLabels[tab] })}</li>
                ) : (
                  rows.map((row, index) => (
                    <li key={row.id} className="kanban-field__row">
                      {row.color ? (
                        <span className="kanban-badge" style={colorStyle(row.color)} aria-hidden="true">
                          {row.name}
                        </span>
                      ) : (
                        <span className="kanban-field__name">{row.name}</span>
                      )}
                      <span className="kanban-field__usage">{t('kanbanField.usage', { count: row.usage })}</span>
                      {fixedPrioritiesReadOnly && tab === 'priorities' ? null : (
                        <span className="kanban-field__tools">
                          {tab === 'priorities' ? (
                            <>
                              <button type="button" className="good-icon-button" aria-label={t('kanbanField.moveUp', { name: row.name })} disabled={busy || index === 0} onClick={() => void move(row.id, -1)}>↑</button>
                              <button type="button" className="good-icon-button" aria-label={t('kanbanField.moveDown', { name: row.name })} disabled={busy || index === rows.length - 1} onClick={() => void move(row.id, 1)}>↓</button>
                            </>
                          ) : null}
                          <button type="button" className="good-icon-button" aria-label={t('kanbanField.editItem', { name: row.name })} disabled={busy} onClick={() => beginEdit(row.color ? { id: row.id, name: row.name, color: row.color } : { id: row.id, name: row.name })}>
                            <Pencil aria-hidden="true" />
                          </button>
                          <button type="button" className="good-icon-button" aria-label={t('kanbanField.deleteItem', { name: row.name })} disabled={busy} onClick={() => setConfirmDelete({ id: row.id, name: row.name, usage: row.usage })}>
                            <Trash2 aria-hidden="true" />
                          </button>
                        </span>
                      )}
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </TabPanel>
        </div>
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
      {confirmLinking ? (
        <ConfirmDialog
          title={t('taskSettings.enableTitle')}
          description={t('taskSettings.enableDescription')}
          confirmLabel={t('taskSettings.enableConfirm')}
          busyLabel={t('common.saving')}
          busy={busy}
          onCancel={() => setConfirmLinking(false)}
          onConfirm={() => void enableLinking()}
        />
      ) : null}
    </>
  );
}

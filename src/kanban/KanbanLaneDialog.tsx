import { X } from 'lucide-react';
import { type RefObject, useId, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import type { RepositoryError } from '../data/nowly-repository';
import { ColorPicker } from '../components/ColorPicker';
import { kanbanColorPresets,
  type KanbanColor,
  type KanbanLane,
  type KanbanLaneDraft
} from './kanban-model';
import type { HexColor } from '../lib/color';
import { t } from '../i18n';

type LaneDialogProps = {
  mode: { type: 'create' } | { type: 'edit'; lane: KanbanLane; cardCount: number };
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onCreate(draft: KanbanLaneDraft): Promise<unknown>;
  onUpdate(lane: KanbanLane, draft: KanbanLaneDraft): Promise<unknown>;
  onDelete(lane: KanbanLane): Promise<unknown>;
  recentColors?: HexColor[];
  onRememberCustomColor?: (color: HexColor) => Promise<void> | void;
};

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? (error.message as string)
    : t('common.opFailed');
}

export function KanbanLaneDialog({ mode, restoreFocusRef, onClose, onCreate, onUpdate, onDelete, recentColors = [], onRememberCustomColor }: LaneDialogProps) {
  const initial = useMemo(
    () =>
      mode.type === 'edit'
        ? { name: mode.lane.name, color: mode.lane.color }
        : { name: '', color: kanbanColorPresets()[0].value as KanbanColor },
    [mode]
  );
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState<KanbanColor>(initial.color);
  const [error, setError] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleId = useId();

  const dirty = name !== initial.name || color !== initial.color;

  function requestClose() {
    if (busy) return;
    onClose();
  }

  async function save() {
    if (!name.trim()) {
      setError(t('kanbanLaneDialog.errorName'));
      return;
    }
    setError('');
    setDialogError('');
    setBusy(true);
    try {
      const draft: KanbanLaneDraft = { name: name.trim(), color };
      if (mode.type === 'create') await onCreate(draft);
      else await onUpdate(mode.lane, draft);
      if (onRememberCustomColor && !kanbanColorPresets().some((preset) => preset.value === color)) await onRememberCustomColor(color);
      onClose();
    } catch (reason) {
      const repositoryError = reason as RepositoryError;
      if (repositoryError.code === 'validation_error' && repositoryError.field === 'name') {
        setError(repositoryError.message);
      } else {
        setDialogError(message(reason));
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (mode.type !== 'edit') return;
    setBusy(true);
    setDialogError('');
    try {
      await onDelete(mode.lane);
      setConfirmDelete(false);
      onClose();
    } catch (reason) {
      setDialogError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        title={mode.type === 'create' ? t('kanbanLaneDialog.createTitle') : t('kanbanLaneDialog.editTitle')}
        ariaLabelledBy={titleId}
        isTopLayer={!confirmDelete}
        restoreFocusRef={restoreFocusRef}
        onRequestClose={requestClose}
        className="kanban-lane-dialog"
        headerActions={
          <button type="button" aria-label={t('common.close')} className="good-icon-button" disabled={busy} onClick={requestClose}>
            <X aria-hidden="true" />
          </button>
        }
        footer={
          <div className="kanban-dialog__actions">
            {dialogError && !confirmDelete ? (
              <div role="alert" className="dialog-error">
                {dialogError}
              </div>
            ) : null}
            {mode.type === 'edit' ? (
              <button
                type="button"
                className="good-button good-button--danger-ghost"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                {t('kanbanLaneDialog.deleteLane')}
              </button>
            ) : null}
            <button type="button" className="good-button" disabled={busy} onClick={requestClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="good-button good-button--primary"
              disabled={busy || (mode.type === 'edit' && !dirty)}
              onClick={() => void save()}
            >
              {busy ? t('common.saving') : t('kanbanLaneDialog.saveLane')}
            </button>
          </div>
        }
      >
        <form className="kanban-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="good-field">
            <label htmlFor="lane-name">{t('kanbanLaneDialog.name')}</label>
            <input
              id="lane-name"
              className="good-input"
              value={name}
              disabled={busy}
              aria-describedby={error ? 'lane-name-error' : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {error ? (
              <span id="lane-name-error" className="field-error">
                {error}
              </span>
            ) : null}
          </div>

          <ColorPicker legend={t('kanbanLaneDialog.color')} name="lane-color" value={color} presets={kanbanColorPresets()} recentColors={recentColors} disabled={busy} onChange={setColor} onRememberColor={onRememberCustomColor} />
        </form>
      </Dialog>

      {confirmDelete && mode.type === 'edit' ? (
        <ConfirmDialog
          title={t('kanbanLaneDialog.deleteTitle', { name: mode.lane.name })}
          description={
            mode.cardCount > 0
              ? t('kanbanLaneDialog.deleteWithCards', { count: mode.cardCount })
              : t('kanbanLaneDialog.deleteEmpty')
          }
          tone="danger"
          confirmLabel={t('common.permanentDelete')}
          busyLabel={t('common.deleting')}
          busy={busy}
          errorMessage={dialogError}
          onCancel={() => {
            setConfirmDelete(false);
            setDialogError('');
          }}
          onConfirm={() => void remove()}
        />
      ) : null}
    </>
  );
}

import { Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { type RefObject, useState } from 'react';
import { ColorPicker } from '../components/ColorPicker';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import type { CalendarSubscription, SubscriptionDraft } from '../calendar/subscription-model';
import { eventColorPresets } from '../calendar/calendar-model';
import { DESIGN_COLORS, type HexColor } from '../lib/color';
import { t } from '../i18n';

const MAX_SOURCES = 3;
const DEFAULT_COLOR = DESIGN_COLORS.primary as HexColor;

type Props = {
  subscriptions: CalendarSubscription[];
  onClose: () => void;
  onChanged: () => void;
  onCreate: (draft: SubscriptionDraft) => Promise<CalendarSubscription>;
  onUpdate: (id: string, draft: SubscriptionDraft) => Promise<CalendarSubscription>;
  onDelete: (id: string) => Promise<void>;
  onRefresh: (id: string) => Promise<void>;
  isTopLayer?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
};

function errorMessage(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? (error as { message: string }).message
    : '';
}

export function SubscriptionManagerDialog({
  subscriptions, onClose, onChanged, onCreate, onUpdate, onDelete, onRefresh,
  isTopLayer = true, restoreFocusRef
}: Props) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState<HexColor>(DEFAULT_COLOR);
  const [interval, setInterval] = useState(15);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const atLimit = subscriptions.length >= MAX_SOURCES && !editingId;

  function resetForm() {
    setName(''); setUrl(''); setColor(DEFAULT_COLOR); setInterval(15);
    setEditingId(null); setFormError('');
  }
  function beginEdit(item: CalendarSubscription) {
    setEditingId(item.id); setName(item.name); setUrl(item.url);
    setColor(item.color); setInterval(item.refreshIntervalMinutes); setFormError('');
  }
  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) { setFormError(t('subscription.errorName')); return; }
    if (!/^(https:\/\/|webcal:\/\/)/i.test(url.trim())) { setFormError(t('subscription.errorUrl')); return; }
    setBusy(true); setFormError('');
    const draft: SubscriptionDraft = { name: trimmed, url: url.trim(), color, refreshIntervalMinutes: interval };
    try {
      if (editingId) await onUpdate(editingId, draft);
      else await onCreate(draft);
      resetForm(); onChanged();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally { setBusy(false); }
  }
  async function confirmRemoval() {
    if (!confirmDelete) return;
    setBusy(true);
    try { await onDelete(confirmDelete.id); setConfirmDelete(null); onChanged(); }
    catch (error) { setFormError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function refresh(id: string) {
    setBusy(true);
    try { await onRefresh(id); onChanged(); }
    finally { setBusy(false); }
  }

  function statusText(item: CalendarSubscription): string {
    if (item.lastStatus === 'ok') return t('subscription.statusOk');
    if (item.lastStatus === 'failed') return item.lastError || t('subscription.statusFailed');
    return t('subscription.statusNever');
  }

  return (
    <>
      <Dialog
        title={t('subscription.title')}
        ariaLabelledBy="subscription-title"
        isTopLayer={isTopLayer && !confirmDelete}
        restoreFocusRef={restoreFocusRef}
        onRequestClose={busy ? () => undefined : onClose}
        className="subscription-dialog"
        headerActions={
          <button className="good-icon-button" aria-label={t('subscription.close')} disabled={busy} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        }
      >
        <form className="subscription-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label className="good-field">
            <span>{t('subscription.name')}</span>
            <input className="good-input" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </label>
          <label className="good-field">
            <span>{t('subscription.url')}</span>
            <input className="good-input" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
          </label>
          <div className="good-field">
            <ColorPicker
              legend={t('subscription.color')}
              name="subscription-color"
              value={color}
              presets={eventColorPresets()}
              recentColors={[]}
              disabled={busy}
              onChange={setColor}
            />
          </div>
          <label className="good-field">
            <span>{t('subscription.interval')}</span>
            <input
              className="good-input" type="number" min={1} max={30} value={interval}
              onChange={(e) => setInterval(Math.max(1, Math.min(30, Number(e.target.value) || 15)))}
              disabled={busy}
            />
          </label>
          {formError ? <div role="alert" className="dialog-error">{formError}</div> : null}
          {atLimit ? <div className="subscription-form__hint">{t('subscription.limit')}</div> : null}
          <div className="subscription-form__actions">
            {editingId ? (
              <button type="button" className="good-button" disabled={busy} onClick={resetForm}>
                {t('subscription.cancel')}
              </button>
            ) : null}
            <button type="submit" className="good-button good-button--primary" disabled={busy || atLimit}>
              {editingId ? t('subscription.save') : t('subscription.add')}
            </button>
          </div>
        </form>

        <ul className="subscription-list">
          {subscriptions.length === 0 ? (
            <li className="subscription-list__empty">{t('subscription.empty')}</li>
          ) : (
            subscriptions.map((item) => (
              <li key={item.id} className="subscription-list__row">
                <span className="subscription-list__dot" style={{ background: item.color }} aria-hidden="true" />
                <span className="subscription-list__name">{item.name}</span>
                <span className={`subscription-list__status is-${item.lastStatus ?? 'never'}`}>{statusText(item)}</span>
                <span className="subscription-list__tools">
                  <button className="good-icon-button" aria-label={t('subscription.refresh')} disabled={busy} onClick={() => void refresh(item.id)}>
                    <RefreshCw aria-hidden="true" />
                  </button>
                  <button className="good-icon-button" aria-label={t('subscription.edit', { name: item.name })} disabled={busy} onClick={() => beginEdit(item)}>
                    <Pencil aria-hidden="true" />
                  </button>
                  <button className="good-icon-button" aria-label={t('subscription.delete', { name: item.name })} disabled={busy} onClick={() => setConfirmDelete({ id: item.id, name: item.name })}>
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
          title={t('subscription.deleteTitle', { name: confirmDelete.name })}
          description={t('subscription.deleteBody')}
          tone="danger"
          confirmLabel={t('subscription.deleteConfirm')}
          busyLabel={t('subscription.deleting')}
          busy={busy}
          onConfirm={() => void confirmRemoval()}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </>
  );
}

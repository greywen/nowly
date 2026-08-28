import { Pencil, Plug, RefreshCw, Trash2, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ColorPicker } from '../components/ColorPicker';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Select } from '../components/Select';
import { useNowlyRepository } from '../data/RepositoryContext';
import type {
  CalendarSubscription,
  OAuthAccount,
  RemoteCalendar,
  SubscriptionDraft,
  SubscriptionProvider
} from './subscription-model';
import { eventColorPresets } from './calendar-model';
import { DESIGN_COLORS, type HexColor } from '../lib/color';
import { t } from '../i18n';

// Backend caps subscriptions at 50; the UI mirrors that so the add controls
// disable at the same point the command would reject.
const MAX_SOURCES = 50;
const DEFAULT_COLOR = DESIGN_COLORS.primary as HexColor;
// OAuth providers that offer a real API connection alongside the ICS link path.
const OAUTH_PROVIDERS: SubscriptionProvider[] = ['google', 'microsoft'];

type Props = {
  subscriptions: CalendarSubscription[];
  onChanged: () => void;
  onCreate: (draft: SubscriptionDraft) => Promise<CalendarSubscription>;
  onUpdate: (id: string, draft: SubscriptionDraft) => Promise<CalendarSubscription>;
  onDelete: (id: string) => Promise<void>;
  onRefresh: (id: string) => Promise<void>;
  // The delete confirmation renders its own dialog above the host dialog; the
  // host needs to know so it can hand over Escape and focus trapping.
  onOverlayOpenChange?: (open: boolean) => void;
};

function errorMessage(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? (error as { message: string }).message
    : '';
}

// Provider-specific label for the subscription list badge.
function providerLabel(provider: SubscriptionProvider): string {
  if (provider === 'google') return t('subscription.sourceGoogle');
  if (provider === 'microsoft') return t('subscription.sourceMicrosoft');
  return t('subscription.sourceIcs');
}

export function SubscriptionManagerPanel({
  subscriptions, onChanged, onCreate, onUpdate, onDelete, onRefresh, onOverlayOpenChange
}: Props) {
  const repository = useNowlyRepository();
  // Which source the creation flow targets. Editing reuses the form but keeps
  // the row's own provider, tracked separately in `editing`.
  const [provider, setProvider] = useState<SubscriptionProvider>('ics');

  // Shared form fields (ICS create/edit + OAuth display edit).
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState<HexColor>(DEFAULT_COLOR);
  const [interval, setIntervalMinutes] = useState(15);
  const [editing, setEditing] = useState<{ id: string; provider: SubscriptionProvider } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  // OAuth state: connected accounts, the picked account's remote calendars and
  // the checkboxes the user ticked before subscribing.
  const [accounts, setAccounts] = useState<OAuthAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [remoteCalendars, setRemoteCalendars] = useState<RemoteCalendar[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthError, setOauthError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState<{ id: string; name: string } | null>(null);

  const isOAuthProvider = OAUTH_PROVIDERS.includes(provider);
  const atLimit = subscriptions.length >= MAX_SOURCES && !editing;
  // Remote-calendar ids already subscribed under the picked account, so the
  // picker can show them as taken instead of offering a duplicate.
  const subscribedRemoteIds = new Set(
    subscriptions
      .filter((item) => item.accountId === selectedAccountId && item.remoteCalendarId)
      .map((item) => item.remoteCalendarId as string)
  );

  // Load connected accounts whenever the create flow targets an OAuth provider.
  // ICS never triggers this, so pure-ICS usage makes no backend call.
  useEffect(() => {
    if (!isOAuthProvider || editing) return;
    let cancelled = false;
    setOauthError('');
    void repository
      .listOAuthAccounts()
      .then((all) => {
        if (cancelled) return;
        const forProvider = all.filter((account) => account.provider === provider);
        setAccounts(forProvider);
        // Auto-select the only account so the picker is one step shorter.
        setSelectedAccountId((current) => current ?? (forProvider[0]?.id ?? null));
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, isOAuthProvider, editing, repository]);

  // Load the picked account's remote calendars for the checkbox picker.
  useEffect(() => {
    if (!isOAuthProvider || editing || !selectedAccountId) {
      setRemoteCalendars([]);
      return;
    }
    let cancelled = false;
    setOauthBusy(true);
    setOauthError('');
    void repository
      .listRemoteCalendars(selectedAccountId)
      .then((list) => {
        if (!cancelled) setRemoteCalendars(list);
      })
      .catch((error) => {
        if (!cancelled) {
          setRemoteCalendars([]);
          setOauthError(errorMessage(error) || t('subscription.oauthError'));
        }
      })
      .finally(() => {
        if (!cancelled) setOauthBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, provider, isOAuthProvider, editing, repository]);

  function askDelete(target: { id: string; name: string } | null) {
    setConfirmDelete(target);
    onOverlayOpenChange?.(target !== null || confirmDisconnect !== null);
  }
  function askDisconnect(target: { id: string; name: string } | null) {
    setConfirmDisconnect(target);
    onOverlayOpenChange?.(target !== null || confirmDelete !== null);
  }
  function resetForm() {
    setName(''); setUrl(''); setColor(DEFAULT_COLOR); setIntervalMinutes(15);
    setEditing(null); setFormError('');
  }
  function beginEdit(item: CalendarSubscription) {
    setEditing({ id: item.id, provider: item.provider });
    setName(item.name); setUrl(item.url);
    setColor(item.color); setIntervalMinutes(item.refreshIntervalMinutes); setFormError('');
  }

  // ICS create/edit + OAuth display edit share this submit path. OAuth rows have
  // no URL and go through updateSubscriptionDisplay instead of the ICS update.
  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) { setFormError(t('subscription.errorName')); return; }
    const editingOAuth = editing && editing.provider !== 'ics';
    if (!editingOAuth && !/^(https:\/\/|webcal:\/\/)/i.test(url.trim())) {
      setFormError(t('subscription.errorUrl'));
      return;
    }
    setBusy(true); setFormError('');
    try {
      if (editing) {
        if (editingOAuth) {
          await repository.updateSubscriptionDisplay(editing.id, trimmed, color, interval);
        } else {
          await onUpdate(editing.id, { name: trimmed, url: url.trim(), color, refreshIntervalMinutes: interval });
        }
        onChanged();
      } else {
        // Sync the new source right away so its events appear without waiting
        // for the background poll; onRefresh reloads events + status on return.
        const created = await onCreate({ name: trimmed, url: url.trim(), color, refreshIntervalMinutes: interval });
        await onRefresh(created.id);
        onChanged();
      }
      resetForm();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally { setBusy(false); }
  }
  async function confirmRemoval() {
    if (!confirmDelete) return;
    setBusy(true);
    try { await onDelete(confirmDelete.id); askDelete(null); onChanged(); }
    catch (error) { setFormError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function refresh(id: string) {
    setBusy(true);
    try { await onRefresh(id); onChanged(); }
    finally { setBusy(false); }
  }

  // Open the system browser for the provider consent screen, then store the
  // returned account and select it so its calendars load.
  async function connectAccount() {
    if (!isOAuthProvider) return;
    setOauthBusy(true); setOauthError('');
    try {
      const account = await repository.startOAuthLogin(provider as 'google' | 'microsoft');
      setAccounts((current) => {
        const without = current.filter((item) => item.id !== account.id);
        return [...without, account];
      });
      setSelectedAccountId(account.id);
      setChecked(new Set());
    } catch (error) {
      setOauthError(errorMessage(error) || t('subscription.oauthError'));
    } finally {
      setOauthBusy(false);
    }
  }
  async function confirmDisconnectAccount() {
    if (!confirmDisconnect) return;
    setOauthBusy(true);
    try {
      await repository.disconnectOAuthAccount(confirmDisconnect.id);
      setAccounts((current) => current.filter((item) => item.id !== confirmDisconnect.id));
      if (selectedAccountId === confirmDisconnect.id) {
        setSelectedAccountId(null);
        setRemoteCalendars([]);
      }
      askDisconnect(null);
      onChanged();
    } catch (error) {
      setOauthError(errorMessage(error) || t('subscription.oauthError'));
    } finally {
      setOauthBusy(false);
    }
  }
  function toggleCalendar(id: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  // Subscribe every ticked calendar, then sync each so events show at once.
  async function subscribeChecked() {
    if (!selectedAccountId || checked.size === 0) return;
    setOauthBusy(true); setOauthError('');
    try {
      for (const remote of remoteCalendars) {
        if (!checked.has(remote.id)) continue;
        const created = await repository.subscribeRemoteCalendar(
          selectedAccountId,
          remote.id,
          remote.name,
          (remote.color as HexColor) || DEFAULT_COLOR,
          15
        );
        await onRefresh(created.id);
      }
      setChecked(new Set());
      onChanged();
    } catch (error) {
      setOauthError(errorMessage(error) || t('subscription.oauthError'));
    } finally {
      setOauthBusy(false);
    }
  }

  function statusText(item: CalendarSubscription): string {
    if (item.lastStatus === 'ok') return t('subscription.statusOk');
    if (item.lastStatus === 'failed') return item.lastError || t('subscription.statusFailed');
    return t('subscription.statusNever');
  }

  const guideTitleKey = provider === 'google'
    ? 'subscription.googleGuideTitle'
    : provider === 'microsoft'
      ? 'subscription.microsoftGuideTitle'
      : 'subscription.icsGuideTitle';
  const guideKey = provider === 'google'
    ? 'subscription.googleGuide'
    : provider === 'microsoft'
      ? 'subscription.microsoftGuide'
      : 'subscription.icsGuide';

  return (
    <>
      {/* Editing hides the source chooser; the row's own provider decides the form. */}
      {!editing ? (
        <div className="good-field">
          <Select
            id="subscription-source"
            label={t('subscription.source')}
            value={provider}
            options={[
              { value: 'google', label: t('subscription.sourceGoogle') },
              { value: 'microsoft', label: t('subscription.sourceMicrosoft') },
              { value: 'ics', label: t('subscription.sourceIcs') }
            ]}
            onChange={(value) => { setProvider(value as SubscriptionProvider); setOauthError(''); }}
          />
        </div>
      ) : null}

      {/* Source guidance: how to obtain an ICS link, or a hint for the OAuth flow. */}
      {!editing ? (
        <div className="subscription-guide">
          <p className="subscription-guide__title">{t(guideTitleKey)}</p>
          <p className="subscription-guide__body">{t(guideKey)}</p>
        </div>
      ) : null}

      {/* OAuth create flow: connect an account, then tick calendars to subscribe. */}
      {isOAuthProvider && !editing ? (
        <div className="subscription-oauth">
          <div className="subscription-oauth__accounts">
            <div className="subscription-oauth__accounts-head">
              <span className="subscription-oauth__label">{t('subscription.oauthAccounts')}</span>
              <button
                type="button"
                className="good-button good-button--primary"
                disabled={oauthBusy}
                onClick={() => void connectAccount()}
              >
                <Plug aria-hidden="true" />
                {oauthBusy ? t('subscription.oauthConnecting') : t('subscription.oauthConnect')}
              </button>
            </div>
            {accounts.length === 0 ? (
              <p className="subscription-oauth__empty">{t('subscription.oauthNoAccounts')}</p>
            ) : (
              <ul className="subscription-oauth__list">
                {accounts.map((account) => (
                  <li
                    key={account.id}
                    className={`subscription-oauth__row${account.id === selectedAccountId ? ' is-selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="subscription-oauth__pick"
                      aria-pressed={account.id === selectedAccountId}
                      onClick={() => { setSelectedAccountId(account.id); setChecked(new Set()); }}
                    >
                      {account.accountLabel}
                    </button>
                    <button
                      type="button"
                      className="good-icon-button"
                      aria-label={t('subscription.oauthDisconnect', { name: account.accountLabel })}
                      disabled={oauthBusy}
                      onClick={() => askDisconnect({ id: account.id, name: account.accountLabel })}
                    >
                      <Unplug aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Calendar picker for the selected account. */}
          {selectedAccountId ? (
            <div className="subscription-picker">
              <span className="subscription-oauth__label">{t('subscription.pickCalendars')}</span>
              <p className="subscription-oauth__hint">{t('subscription.pickCalendarsHint')}</p>
              {remoteCalendars.length === 0 ? (
                <p className="subscription-oauth__empty">{t('subscription.pickEmpty')}</p>
              ) : (
                <ul className="subscription-picker__list">
                  {remoteCalendars.map((remote) => {
                    const already = subscribedRemoteIds.has(remote.id);
                    return (
                      <li key={remote.id} className="subscription-picker__row">
                        <label className="form-check form-check-custom form-check-solid">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={already || checked.has(remote.id)}
                            disabled={already || oauthBusy}
                            onChange={() => toggleCalendar(remote.id)}
                          />
                          <span className="form-check-label">
                            <span
                              className="subscription-list__dot"
                              style={{ background: remote.color || DEFAULT_COLOR }}
                              aria-hidden="true"
                            />
                            {remote.name}
                          </span>
                        </label>
                        {already ? (
                          <span className="subscription-picker__taken">{t('subscription.alreadySubscribed')}</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {oauthError ? <div role="alert" className="dialog-error">{oauthError}</div> : null}
              <div className="subscription-form__actions">
                <button
                  type="button"
                  className="good-button good-button--primary"
                  disabled={oauthBusy || checked.size === 0 || atLimit}
                  onClick={() => void subscribeChecked()}
                >
                  {oauthBusy ? t('subscription.subscribing') : t('subscription.subscribe')}
                </button>
              </div>
            </div>
          ) : null}
          {oauthError && !selectedAccountId ? <div role="alert" className="dialog-error">{oauthError}</div> : null}
        </div>
      ) : null}

      {/* ICS create form + edit form (both ICS and OAuth display edits). */}
      {(!isOAuthProvider || editing) ? (
        <form className="subscription-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label className="good-field">
            <span>{t('subscription.name')}</span>
            <input className="good-input" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </label>
          {/* OAuth rows have no editable URL; only ICS shows the link field. */}
          {!editing || editing.provider === 'ics' ? (
            <label className="good-field">
              <span>{t('subscription.url')}</span>
              <input className="good-input" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
            </label>
          ) : null}
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
              onChange={(e) => setIntervalMinutes(Math.max(1, Math.min(30, Number(e.target.value) || 15)))}
              disabled={busy}
            />
          </label>
          {formError ? <div role="alert" className="dialog-error">{formError}</div> : null}
          {atLimit ? <div className="subscription-form__hint">{t('subscription.limit')}</div> : null}
          <div className="subscription-form__actions">
            {editing ? (
              <button type="button" className="good-button" disabled={busy} onClick={resetForm}>
                {t('subscription.cancel')}
              </button>
            ) : null}
            <button type="submit" className="good-button good-button--primary" disabled={busy || atLimit}>
              {editing ? t('subscription.save') : t('subscription.add')}
            </button>
          </div>
        </form>
      ) : null}

      <ul className="subscription-list">
        {subscriptions.length === 0 ? (
          <li className="subscription-list__empty">{t('subscription.empty')}</li>
        ) : (
          subscriptions.map((item) => (
            <li key={item.id} className="subscription-list__row">
              <span className="subscription-list__dot" style={{ background: item.color }} aria-hidden="true" />
              <span className="subscription-list__name">{item.name}</span>
              <span className="subscription-list__provider">{providerLabel(item.provider)}</span>
              <span className={`subscription-list__status is-${item.lastStatus ?? 'never'}`}>{statusText(item)}</span>
              <span className="subscription-list__tools">
                <button type="button" className="good-icon-button" aria-label={t('subscription.refresh')} disabled={busy} onClick={() => void refresh(item.id)}>
                  <RefreshCw aria-hidden="true" />
                </button>
                <button type="button" className="good-icon-button" aria-label={t('subscription.edit', { name: item.name })} disabled={busy} onClick={() => beginEdit(item)}>
                  <Pencil aria-hidden="true" />
                </button>
                <button type="button" className="good-icon-button" aria-label={t('subscription.delete', { name: item.name })} disabled={busy} onClick={() => askDelete({ id: item.id, name: item.name })}>
                  <Trash2 aria-hidden="true" />
                </button>
              </span>
            </li>
          ))
        )}
      </ul>

      {confirmDelete ? (
        <ConfirmDialog
          title={t('subscription.deleteTitle', { name: confirmDelete.name })}
          description={t('subscription.deleteBody')}
          tone="danger"
          confirmLabel={t('subscription.deleteConfirm')}
          busyLabel={t('subscription.deleting')}
          busy={busy}
          onConfirm={() => void confirmRemoval()}
          onCancel={() => askDelete(null)}
        />
      ) : null}

      {confirmDisconnect ? (
        <ConfirmDialog
          title={t('subscription.oauthDisconnectTitle', { name: confirmDisconnect.name })}
          description={t('subscription.oauthDisconnectBody')}
          tone="danger"
          confirmLabel={t('subscription.oauthDisconnectConfirm')}
          busyLabel={t('subscription.deleting')}
          busy={oauthBusy}
          onConfirm={() => void confirmDisconnectAccount()}
          onCancel={() => askDisconnect(null)}
        />
      ) : null}
    </>
  );
}

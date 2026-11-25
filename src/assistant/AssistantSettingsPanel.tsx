import { useTranslation } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Combobox } from '../components/Combobox';
import { RefreshCw } from '../components/icons';
import { assistantClient, assistantErrorSource, translateAssistantNotice } from './client';
import { connectionReady, isLocalEndpoint, type AssistantClient, type AssistantConfig, type Permissions, type Protocol } from './types';
import './assistant.css';

const emptyConfig: AssistantConfig = { endpoint: '', model: '', hasKey: false, permissions: { calendar: false, tasks: false, external: false, notes: false, alarms: false, externalWrite: false } };
const PROTOCOL_LABELS: Record<Protocol, string> = {
  openaiChat: 'OpenAI Chat Completions', openaiResponses: 'OpenAI Responses', azure: 'Azure OpenAI',
  anthropic: 'Anthropic Messages', gemini: 'Gemini', ollama: 'Ollama'
};
const PERMISSION_FIELDS = ['calendar', 'tasks', 'notes', 'alarms', 'external', 'externalWrite'] as const;
const MODEL_FETCH_DELAY = 600;

function normalizeEndpoint(raw: string) { return raw.trim().replace(/\/+$/, ''); }
function isHttpUrl(raw: string) {
  try { return ['http:', 'https:'].includes(new URL(raw).protocol); } catch { return false; }
}
function samePermissions(a: Permissions, b: Permissions) {
  return PERMISSION_FIELDS.every(field => Boolean(a[field]) === Boolean(b[field]));
}

export function AssistantSettingsPanel({ client = assistantClient }: { client?: AssistantClient }) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [unavailable, setUnavailable] = useState('');
  const [draft, setDraft] = useState<AssistantConfig>(emptyConfig);
  const [key, setKey] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const lock = useRef(false);
  const fetchId = useRef(0);

  useEffect(() => {
    let alive = true;
    void client.getConfig().then(c => { if (alive) { setConfig(c); setDraft(c); } })
      .catch(() => { if (alive) setUnavailable('assistant.text41'); });
    return () => { alive = false; };
  }, [client]);

  const endpoint = normalizeEndpoint(draft.endpoint);
  const local = isLocalEndpoint(endpoint);
  // A saved key only ever goes back to the exact address it was saved for.
  const savedKeyApplies = Boolean(config?.hasKey) && !clearKey && endpoint === config?.endpoint;
  const showSavedKey = savedKeyApplies && !editingKey;
  const listKey = key || (savedKeyApplies ? null : '');
  const canList = config !== null && isHttpUrl(endpoint) && (key !== '' || savedKeyApplies || local);

  async function loadModels() {
    if (!canList) return;
    const id = ++fetchId.current;
    setModelsLoading(true); setModelsError('');
    try {
      const list = await client.listModels(endpoint, listKey);
      if (id === fetchId.current) setModels(list);
    } catch (reason) {
      if (id === fetchId.current) { setModels([]); setModelsError(assistantErrorSource(reason)); }
    } finally {
      if (id === fetchId.current) setModelsLoading(false);
    }
  }

  useEffect(() => {
    if (!canList) {
      fetchId.current++;
      setModels([]); setModelsError(''); setModelsLoading(false);
      return;
    }
    const timer = window.setTimeout(() => void loadModels(), MODEL_FETCH_DELAY);
    return () => window.clearTimeout(timer);
  }, [canList, endpoint, listKey]);

  async function save() {
    if (lock.current) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const next = await client.saveConfig(draft, key || null, clearKey);
      setKey(''); setClearKey(false); setEditingKey(false); setConfig(next); setDraft(next);
    }
    catch (e) { setError(assistantErrorSource(e)); }
    finally { lock.current = false; setSaving(false); }
  }

  const busy = saving || !config;
  const dirty = config !== null && (endpoint !== config.endpoint || draft.model.trim() !== config.model
    || key !== '' || clearKey || !samePermissions(draft.permissions, config.permissions));
  const status = saving ? 'testing' : dirty ? 'changed' : connectionReady(config) ? 'connected' : 'none';
  const statusText = status === 'testing' ? t('assistant.text52')
    : status === 'changed' ? t('settings.aiStatusChanged')
    : status === 'connected' ? t('settings.aiStatusConnected', { protocol: PROTOCOL_LABELS[config?.protocol ?? 'openaiChat'] })
    : t('settings.aiStatusNone');
  const permissionLabels: Record<typeof PERMISSION_FIELDS[number], string> = {
    calendar: t('assistant.text55'), tasks: t('assistant.text56'), notes: t('assistant.permissionNotes'),
    alarms: t('assistant.permissionAlarms'), external: t('assistant.text57'), externalWrite: t('assistant.permissionExternalWrite')
  };

  return <>
    {unavailable && <p className="settings-section__note" role="alert">{translateAssistantNotice(unavailable)}</p>}
    <fieldset className="settings-section assistant-connection" aria-busy={!config}>
      <legend>{t('settings.aiConnection')}</legend>
      <label className="assistant-field">{t('assistant.text45')}
        <input value={draft.endpoint} placeholder="https://api.example.com/v1" autoComplete="off" spellCheck={false} disabled={busy}
          onChange={e => setDraft({ ...draft, endpoint: e.target.value })} />
      </label>
      {showSavedKey
        ? <div className="assistant-field" role="group" aria-labelledby="assistant-key-label">
            <span id="assistant-key-label">API Key</span>
            <div className="assistant-key">
              <span className="assistant-key__value"><span aria-hidden="true">••••••••••••</span><span className="assistant-key__state">{t('settings.aiKeySaved')}</span></span>
              <button type="button" className="good-button" disabled={busy} onClick={() => setEditingKey(true)}>{t('settings.aiKeyChange')}</button>
              <button type="button" className="good-button" disabled={busy} onClick={() => { setClearKey(true); setKey(''); }}>{t('settings.aiKeyRemove')}</button>
            </div>
          </div>
        : clearKey
          ? <div className="assistant-field" role="group" aria-labelledby="assistant-key-label">
              <span id="assistant-key-label">API Key</span>
              <div className="assistant-key">
                <span className="assistant-key__value"><span className="assistant-key__state">{t('settings.aiKeyRemoving')}</span></span>
                <button type="button" className="good-button" disabled={busy} onClick={() => setClearKey(false)}>{t('settings.aiKeyUndo')}</button>
              </div>
            </div>
          : <div className="assistant-field">
              <label htmlFor="assistant-key-input">API Key</label>
              <div className="assistant-key">
                <input id="assistant-key-input" type="password" value={key} autoComplete="new-password" disabled={busy}
                  placeholder={local ? t('settings.aiKeyOptional') : t('assistant.text49')}
                  onChange={e => setKey(e.target.value)} />
                {savedKeyApplies && <button type="button" className="good-button" disabled={busy} onClick={() => { setEditingKey(false); setKey(''); }}>{t('common.cancel')}</button>}
              </div>
            </div>}
      <div className="assistant-field">
        <Combobox id="assistant-model" label={t('settings.aiModel')} value={draft.model} options={models} disabled={busy}
          placeholder={t('settings.aiModelPlaceholder')} loading={modelsLoading} loadingText={t('settings.aiModelsLoading')}
          emptyText={models.length || modelsError ? t('settings.aiModelsEmpty') : t('settings.aiModelsWaiting')}
          toggleLabel={t('settings.aiModelsToggle')} describedBy={modelsError ? 'assistant-model-error' : undefined}
          onChange={model => setDraft(current => ({ ...current, model }))}
          trailing={<button type="button" className="good-icon-button" aria-label={t('settings.aiModelsRefresh')} title={t('settings.aiModelsRefresh')}
            disabled={busy || !canList || modelsLoading} aria-busy={modelsLoading} onClick={() => void loadModels()}><RefreshCw aria-hidden="true" /></button>} />
        {modelsError && <div id="assistant-model-error" className="assistant-field__error">
          <span>{t('settings.aiModelsError')}</span>
          <details><summary>{t('assistant.text60')}</summary><pre>{translateAssistantNotice(modelsError)}</pre></details>
        </div>}
      </div>
      <div className="assistant-connection__footer">
        <span className={`assistant-connection__status assistant-connection__status--${status}`} role="status">
          <span className="assistant-connection__dot" aria-hidden="true" />{statusText}
        </span>
        <button type="button" className="good-button good-button--primary" disabled={busy} onClick={() => void save()}>
          {saving ? t('assistant.text61') : clearKey ? t('assistant.text62') : t('assistant.text63')}
        </button>
      </div>
      {error && <div className="assistant-settings-error">
        <p role="alert" className="assistant-error">{t('assistant.text59')}</p>
        <details><summary>{t('assistant.text60')}</summary><pre>{translateAssistantNotice(error)}</pre></details>
      </div>}
    </fieldset>
    <fieldset className="settings-section assistant-permissions">
      <legend>{t('assistant.text54')}</legend>
      {PERMISSION_FIELDS.map(field =>
        <label className={`form-check form-check-custom form-check-solid${field === 'externalWrite' ? ' assistant-permissions__nested' : ''}`} key={field}>
          <input className="form-check-input" type="checkbox" checked={Boolean(draft.permissions[field])}
            disabled={busy || (field === 'externalWrite' && !draft.permissions.external)}
            onChange={e => setDraft({ ...draft, permissions: {
              ...draft.permissions, [field]: e.target.checked,
              // Writing a connected calendar needs reading it first.
              ...(field === 'external' && !e.target.checked ? { externalWrite: false } : {})
            } })} />
          <span className="form-check-label">{permissionLabels[field]}</span>
        </label>)}
      <p className="settings-section__note">{t('settings.aiPermissionsNote')}</p>
    </fieldset>
  </>;
}

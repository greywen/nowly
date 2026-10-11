import { useTranslation, t, getLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { assistantClient, assistantErrorSource, translateAssistantNotice, assistantNotice } from './client';
import type { AssistantClient, AssistantConfig } from './types';
import './assistant.css';

const emptyConfig: AssistantConfig = { endpoint: '', model: '', hasKey: false, permissions: { calendar: false, tasks: false, external: false } };

export function AssistantSettingsPanel({ client = assistantClient }: { client?: AssistantClient }) {
  const { t, language } = useTranslation();
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [unavailable, setUnavailable] = useState('');
  const [draft, setDraft] = useState<AssistantConfig>(emptyConfig); const [key, setKey] = useState('');
  const [clearKey, setClearKey] = useState(false); const [error, setError] = useState('');
  const [saved, setSaved] = useState(''); const [saving, setSaving] = useState(false); const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    void client.getConfig().then(c => { if (alive) { setConfig(c); setDraft(c); } })
      .catch(() => { if (alive) setUnavailable('assistant.text41'); });
    return () => { alive = false; };
  }, [client]);
  async function save() {
    if (lock.current) return;
    lock.current = true; setSaving(true); setError(''); setSaved('');
    try {
      const next = await client.saveConfig(draft, key || null, clearKey);
      setKey(''); setClearKey(false); setConfig(next); setDraft(next);
      setSaved(next.detectedEndpoint ? 'assistant.text42' : 'assistant.text43');
    }
    catch (e) { setError(assistantErrorSource(e)); }
    finally { lock.current = false; setSaving(false); }
  }
  const busy = saving || !config;
  return <div className="assistant-form">
    {unavailable && <p role="alert">{translateAssistantNotice(unavailable)}</p>}
    <p>{t('assistant.text44')}</p>
    <label>{t('assistant.text45')}<input value={draft.endpoint} placeholder="https://api.example.com/v1" autoComplete="off" disabled={busy}
      onChange={e => setDraft({ ...draft, endpoint: e.target.value })} /></label>
    <p className="assistant-caption">{t('assistant.text46')}</p>
    <label>Model ID<input value={draft.model} placeholder={t('assistant.text47')} autoComplete="off" disabled={busy}
      onChange={e => setDraft({ ...draft, model: e.target.value })} /></label>
    <label>API Key<input type="password" value={key} autoComplete="new-password"
      placeholder={config?.hasKey ? t('assistant.text48') : t('assistant.text49')}
      disabled={clearKey || busy} onChange={e => setKey(e.target.value)} /></label>
    <p className="assistant-caption">{t('assistant.text50')}</p>
    <p className="assistant-caption">{t('assistant.text51')}</p>
    {saving && <p role="status">{t('assistant.text52')}</p>}
    {config?.hasKey && <label className="form-check form-check-custom form-check-solid">
      <input className="form-check-input" type="checkbox" checked={clearKey} disabled={saving} onChange={e => { setClearKey(e.target.checked); setKey(''); }} />
      <span className="form-check-label">{t('assistant.text53')}</span>
    </label>}
    <fieldset><legend>{t('assistant.text54')}</legend>
      {([['calendar', t('assistant.text55')], ['tasks', t('assistant.text56')], ['external', t('assistant.text57')]] as const).map(([field, label]) =>
        <label className="form-check form-check-custom form-check-solid" key={field}>
          <input className="form-check-input" type="checkbox" checked={draft.permissions[field]} disabled={busy}
            onChange={e => setDraft({ ...draft, permissions: { ...draft.permissions, [field]: e.target.checked } })} />
          <span className="form-check-label">{label}</span>
        </label>)}
    </fieldset>
    <p>{t('assistant.text58')}</p>
    {saved && <p role="status">{translateAssistantNotice(saved)}</p>}
    {error && <div className="assistant-settings-error">
      <p role="alert" className="assistant-error">{t('assistant.text59')}</p>
      <details><summary>{t('assistant.text60')}</summary><pre>{translateAssistantNotice(error)}</pre></details>
    </div>}
    <div className="assistant-form-actions">
      <button className="good-button good-button--primary" disabled={busy} onClick={() => void save()}>
        {saving ? t('assistant.text61') : clearKey ? t('assistant.text62') : t('assistant.text63')}
      </button>
    </div>
  </div>;
}

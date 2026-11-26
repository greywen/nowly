import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import { LOCAL_PERMISSIONS, type Permissions } from '../assistant/types';
import '../assistant/assistant.css';
import './agent-settings.css';

export type AgentConfig = { enabled: boolean; permissions: Permissions };
export type AgentBridgeClient = {
  getConfig(): Promise<AgentConfig>;
  saveConfig(config: AgentConfig): Promise<AgentConfig>;
  skillMd(): Promise<string>;
};

export const agentBridgeClient: AgentBridgeClient = {
  getConfig: () => invoke('agent_bridge_get_config'),
  saveConfig: config => invoke('agent_bridge_save_config', { config }),
  skillMd: () => invoke('agent_bridge_skill_md')
};

const empty: AgentConfig = { enabled: false, permissions: LOCAL_PERMISSIONS };

export function AgentSettingsPanel({ client = agentBridgeClient }: { client?: AgentBridgeClient }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<AgentConfig>(empty);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    void client.getConfig().then(c => { if (alive) { setDraft(c); setLoaded(true); } })
      .catch(() => { if (alive) setError(t('agents.loadError')); });
    return () => { alive = false; };
  }, [client, t]);
  async function run(task: () => Promise<string>, failure: string) {
    if (lock.current) return;
    lock.current = true; setSaving(true); setNotice(''); setError('');
    try { setNotice(await task()); }
    catch { setError(t(failure)); }
    finally { lock.current = false; setSaving(false); }
  }
  const save = () => run(async () => { setDraft(await client.saveConfig(draft)); return t('agents.saved'); }, 'agents.saveError');
  const copy = () => run(async () => { await navigator.clipboard.writeText(await client.skillMd()); return t('agents.copied'); }, 'agents.copyError');
  const busy = saving || !loaded;
  const permissions: [keyof Permissions, string][] = [
    ['calendar', t('assistant.text55')], ['tasks', t('assistant.text56')], ['notes', t('assistant.permissionNotes')],
    ['alarms', t('assistant.permissionAlarms')], ['external', t('assistant.text57')], ['externalWrite', t('assistant.permissionExternalWrite')]
  ];
  return <div className="assistant-form agent-settings">
    <label className="form-check form-check-custom form-check-solid">
      <input className="form-check-input" type="checkbox" checked={draft.enabled} disabled={busy}
        onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />
      <span className="form-check-label">{t('agents.enable')}</span>
    </label>
    <fieldset disabled={busy || !draft.enabled}><legend>{t('agents.permissions')}</legend>
      {permissions.map(([field, label]) =>
        <label className="form-check form-check-custom form-check-solid" key={field}>
          <input className="form-check-input" type="checkbox" checked={Boolean(draft.permissions[field])}
            disabled={field === 'externalWrite' && !draft.permissions.external}
            onChange={e => setDraft({ ...draft, permissions: {
              ...draft.permissions, [field]: e.target.checked,
              // Writing a connected calendar needs reading it first.
              ...(field === 'external' && !e.target.checked ? { externalWrite: false } : {})
            } })} />
          <span className="form-check-label">{label}</span>
        </label>)}
    </fieldset>
    <div className="assistant-form-actions">
      <button className="good-button good-button--primary" disabled={busy} onClick={() => void save()}>
        {saving ? t('common.saving') : t('agents.save')}
      </button>
    </div>
    <fieldset><legend>{t('agents.install')}</legend>
      <ol className="agent-settings__steps">
        <li>{t('agents.stepEnable')}</li>
        <li><button className="good-button" disabled={busy} onClick={() => void copy()}>{t('agents.copy')}</button></li>
        <li>{t('agents.stepInstall')}</li>
      </ol>
    </fieldset>
    {notice && <p role="status" className="agent-settings__notice">{notice}</p>}
    {error && <p role="alert" className="assistant-settings-error">{error}</p>}
  </div>;
}

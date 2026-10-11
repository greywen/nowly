import { useEffect, useRef, useState } from 'react';
import { assistantClient, assistantError } from './client';
import type { AssistantClient, AssistantConfig } from './types';
import './assistant.css';

const emptyConfig: AssistantConfig = { endpoint: '', model: '', hasKey: false, permissions: { calendar: false, tasks: false, external: false } };

export function AssistantSettingsPanel({ client = assistantClient }: { client?: AssistantClient }) {
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [unavailable, setUnavailable] = useState('');
  const [draft, setDraft] = useState<AssistantConfig>(emptyConfig); const [key, setKey] = useState('');
  const [clearKey, setClearKey] = useState(false); const [error, setError] = useState('');
  const [saved, setSaved] = useState(''); const [saving, setSaving] = useState(false); const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    void client.getConfig().then(c => { if (alive) { setConfig(c); setDraft(c); } })
      .catch(() => { if (alive) setUnavailable('请在 Nowly 桌面版中设置 AI 连接。网页预览不发送数据或保存 Key。'); });
    return () => { alive = false; };
  }, [client]);
  async function save() {
    if (lock.current) return;
    lock.current = true; setSaving(true); setError(''); setSaved('');
    try {
      const next = await client.saveConfig(draft, key || null, clearKey);
      setKey(''); setClearKey(false); setConfig(next); setDraft(next);
      setSaved(next.detectedEndpoint ? '接口已自动识别，连接与权限已保存。' : '连接与权限已保存。');
    }
    catch (e) { setError(assistantError(e)); }
    finally { lock.current = false; setSaving(false); }
  }
  const busy = saving || !config;
  return <div className="assistant-form">
    {unavailable && <p role="alert">{unavailable}</p>}
    <p>填写 API 地址、Model ID 和 Key；保存时会自动检测连接。</p>
    <label>API 地址<input value={draft.endpoint} placeholder="https://api.example.com/v1" autoComplete="off" disabled={busy}
      onChange={e => setDraft({ ...draft, endpoint: e.target.value })} /></label>
    <p className="assistant-caption">可填服务地址或完整接口地址。Azure 需包含 api-version，本地服务如 http://127.0.0.1:11434。</p>
    <label>Model ID<input value={draft.model} placeholder="模型 ID；Azure 填部署名称" autoComplete="off" disabled={busy}
      onChange={e => setDraft({ ...draft, model: e.target.value })} /></label>
    <label>API Key<input type="password" value={key} autoComplete="new-password"
      placeholder={config?.hasKey ? '已加密保存；留空保留' : '输入你的 API Key'}
      disabled={clearKey || busy} onChange={e => setKey(e.target.value)} /></label>
    <p className="assistant-caption">Key 在本机加密保存，更换地址需重填。本机地址可用 HTTP 和空 Key；远程地址需 HTTPS 和 Key。</p>
    <p className="assistant-caption">检测请求不包含日历、任务或对话，可能产生少量费用。连接成功后保存，失败保留原设置。</p>
    {saving && <p role="status">正在检测连接，最长约 2 分钟…</p>}
    {config?.hasKey && <label className="form-check form-check-custom form-check-solid">
      <input className="form-check-input" type="checkbox" checked={clearKey} disabled={saving} onChange={e => { setClearKey(e.target.checked); setKey(''); }} />
      <span className="form-check-label">清除已保存的 Key</span>
    </label>}
    <fieldset><legend>AI 可访问的数据</legend>
      {([['calendar', '本地日程'], ['tasks', '看板与四象限任务'], ['external', '外部日历（只读）']] as const).map(([field, label]) =>
        <label className="form-check form-check-custom form-check-solid" key={field}>
          <input className="form-check-input" type="checkbox" checked={draft.permissions[field]} disabled={busy}
            onChange={e => setDraft({ ...draft, permissions: { ...draft.permissions, [field]: e.target.checked } })} />
          <span className="form-check-label">{label}</span>
        </label>)}
    </fieldset>
    <p>修改数据前需确认。操作与恢复记录在本机保留 7 天，对话不长期保存。关闭权限不撤回已发送的数据。</p>
    {saved && <p role="status">{saved}</p>}
    {error && <div className="assistant-settings-error">
      <p role="alert" className="assistant-error">连接失败，请检查地址、Model ID 和 Key 后重试。</p>
      <details><summary>查看错误详情</summary><pre>{error}</pre></details>
    </div>}
    <div className="assistant-form-actions">
      <button className="good-button good-button--primary" disabled={busy} onClick={() => void save()}>
        {saving ? '正在检测接口…' : clearKey ? '清除 Key 并保存' : '检测并保存连接'}
      </button>
    </div>
  </div>;
}

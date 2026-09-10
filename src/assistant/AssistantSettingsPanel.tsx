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
      .catch(() => { if (alive) setUnavailable('AI 连接尚不可用。请在 Nowly 桌面版中打开；网页预览不会发送数据或保存 Key。'); });
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
    <p>填写地址、Key 和 Model ID，Nowly 会自动尝试可用接口，无需选择协议。</p>
    <label>API 地址<input value={draft.endpoint} placeholder="https://api.example.com/v1" autoComplete="off" disabled={busy}
      onChange={e => setDraft({ ...draft, endpoint: e.target.value })} /></label>
    <p className="assistant-caption">支持基础地址或完整接口地址。Azure 可直接粘贴带 api-version 的地址；本地服务例如 http://127.0.0.1:11434。</p>
    <label>Model ID<input value={draft.model} placeholder="填写准确模型 ID；Azure 填部署名称" autoComplete="off" disabled={busy}
      onChange={e => setDraft({ ...draft, model: e.target.value })} /></label>
    <label>API Key<input type="password" value={key} autoComplete="new-password"
      placeholder={config?.hasKey ? '已加密保存；留空保留' : '输入你的 API Key'}
      disabled={clearKey || busy} onChange={e => setKey(e.target.value)} /></label>
    <p className="assistant-caption">Key 仅由桌面端加密保存，不回显；更换地址需重新填写。本机回环地址允许 HTTP 和空 Key，远程须使用 HTTPS 和 Key。</p>
    <p className="assistant-caption">保存时会向此主机发送最小测试请求，可能产生少量费用；成功即停止并记住接口。检测不发送日历、任务或对话，失败不会改动原设置。</p>
    {saving && <p role="status">正在按地址和模型名称依次检测，请稍候；每个接口最多 15 秒，最长约 2 分钟。</p>}
    {config?.hasKey && <label className="form-check form-check-custom form-check-solid">
      <input className="form-check-input" type="checkbox" checked={clearKey} disabled={saving} onChange={e => { setClearKey(e.target.checked); setKey(''); }} />
      <span className="form-check-label">清除已保存的 Key</span>
    </label>}
    <fieldset><legend>允许读取与提出变更的范围</legend>
      {([['calendar', '本地日程'], ['tasks', '看板与四象限任务'], ['external', '外部日历（只读）']] as const).map(([field, label]) =>
        <label className="form-check form-check-custom form-check-solid" key={field}>
          <input className="form-check-input" type="checkbox" checked={draft.permissions[field]} disabled={busy}
            onChange={e => setDraft({ ...draft, permissions: { ...draft.permissions, [field]: e.target.checked } })} />
          <span className="form-check-label">{label}</span>
        </label>)}
    </fieldset>
    <p>任何写入仍需逐次确认。操作记录及恢复数据在本机保留 7 天；对话不长期保存。撤回权限不会撤回已经发往服务商的数据。</p>
    {saved && <p role="status">{saved}</p>}
    {error && <div className="assistant-settings-error">
      <p role="alert" className="assistant-error">连接失败，请检查 API 地址、Key 和 Model ID 后重试。</p>
      <details><summary>查看检测详情</summary><pre>{error}</pre></details>
    </div>}
    <div className="assistant-form-actions">
      <button className="good-button good-button--primary" disabled={busy} onClick={() => void save()}>
        {saving ? '正在检测接口…' : clearKey ? '清除 Key 并保存' : '检测并保存连接'}
      </button>
    </div>
  </div>;
}

import { X } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import type { AppSettings, MonitorInfo } from '../data/nowly-repository';

type Props={settings:AppSettings;monitors?:MonitorInfo[];onClose():void;onSave(settings:AppSettings):Promise<AppSettings>};
function errorMessage(error:unknown){return typeof error==='object'&&error!==null&&'message'in error&&typeof error.message==='string'?error.message:'设置保存失败，请重试。'}

export function SettingsDialog({settings,monitors=[],onClose,onSave}:Props){
 const [draft,setDraft]=useState(()=>({...settings})); const [saving,setSaving]=useState(false); const [error,setError]=useState<string|null>(null);
 const toggle=(key:keyof AppSettings)=>(event:React.ChangeEvent<HTMLInputElement>)=>setDraft(current=>({...current,[key]:event.target.checked}));
 async function save(){setSaving(true);setError(null);try{await onSave(draft);onClose();}catch(reason){setError(errorMessage(reason));}finally{setSaving(false)}}
 return <Dialog title="设置" ariaLabelledBy="settings-title" onRequestClose={onClose} className="settings-dialog" headerActions={<button className="good-icon-button" aria-label="关闭设置" onClick={onClose}><X aria-hidden="true"/></button>} footer={<><button className="good-button" onClick={onClose}>取消</button><button className="good-button good-button--primary" disabled={saving} onClick={()=>void save()}>{saving?'正在保存':'保存设置'}</button></>}>
  <div className="settings-form">
   <section><h3>界面</h3><div className="settings-grid">
    <Select id="settings-density" label="界面密度" value={draft.density} options={[{value:'balanced',label:'平衡'},{value:'comfortable',label:'舒适'}]} onChange={value=>setDraft({...draft,density:value as AppSettings['density']})}/>
   </div></section>
   <section><h3>桌面与启动</h3>{monitors.length?<Select id="settings-monitor" label="目标显示器" value={draft.targetMonitorId??monitors.find(item=>item.isPrimary)?.id??monitors[0].id} options={monitors.map(item=>({value:item.id,label:`${item.name}${item.isPrimary?'（主显示器）':''} · ${item.width}×${item.height} · ${Math.round(item.scaleFactor*100)}%`}))} onChange={value=>setDraft({...draft,targetMonitorId:value})}/>:null}<div className="settings-checks">
    <Check label="关闭时恢复壁纸" checked={draft.wallpaperEnabled} onChange={toggle('wallpaperEnabled')}/><Check label="开机自动启动" checked={draft.launchAtLogin} onChange={toggle('launchAtLogin')}/>
   </div></section>
   {error?<div className="dialog-error" role="alert">{error}</div>:null}
  </div>
 </Dialog>;
}
function Check({label,checked,onChange}:{label:string;checked:boolean;onChange:(event:React.ChangeEvent<HTMLInputElement>)=>void}){return <label className="form-check form-check-custom form-check-solid"><input className="form-check-input" type="checkbox" checked={checked} onChange={onChange}/><span className="form-check-label">{label}</span></label>}

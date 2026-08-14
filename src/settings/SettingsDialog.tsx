import { X } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import type { AppSettings, MonitorInfo } from '../data/nowly-repository';
import { t, useTranslation, type Language } from '../i18n';

type Props={settings:AppSettings;monitors?:MonitorInfo[];onClose():void;onSave(settings:AppSettings):Promise<AppSettings>};
function errorMessage(error:unknown){return typeof error==='object'&&error!==null&&'message'in error&&typeof error.message==='string'?error.message:t('settings.saveError')}

export function SettingsDialog({settings,monitors=[],onClose,onSave}:Props){
 // Language switches in real time via the i18n store, independent of the save
 // button, so the whole UI updates the moment the user picks a language.
 const {language,setLanguage}=useTranslation();
 const [draft,setDraft]=useState(()=>({...settings})); const [saving,setSaving]=useState(false); const [error,setError]=useState<string|null>(null);
 const toggle=(key:keyof AppSettings)=>(event:React.ChangeEvent<HTMLInputElement>)=>setDraft(current=>({...current,[key]:event.target.checked}));
 async function save(){setSaving(true);setError(null);try{await onSave(draft);onClose();}catch(reason){setError(errorMessage(reason));}finally{setSaving(false)}}
 return <Dialog title={t('settings.title')} ariaLabelledBy="settings-title" onRequestClose={onClose} className="settings-dialog" headerActions={<button className="good-icon-button" aria-label={t('settings.close')} onClick={onClose}><X aria-hidden="true"/></button>} footer={<><button className="good-button" onClick={onClose}>{t('common.cancel')}</button><button className="good-button good-button--primary" disabled={saving} onClick={()=>void save()}>{saving?t('common.saving'):t('settings.saveSettings')}</button></>}>
  <div className="settings-form">
   <section><h3>{t('settings.interface')}</h3><div className="settings-grid">
    <Select id="settings-language" label={t('settings.language')} value={language} options={[{value:'zh',label:t('settings.langZh')},{value:'en',label:t('settings.langEn')}]} onChange={value=>setLanguage(value as Language)}/>
    <Select id="settings-density" label={t('settings.density')} value={draft.density} options={[{value:'compact',label:t('settings.densityCompact')},{value:'balanced',label:t('settings.densityBalanced')},{value:'comfortable',label:t('settings.densityComfortable')}]} onChange={value=>setDraft({...draft,density:value as AppSettings['density']})}/>
   </div></section>
   <section><h3>{t('settings.desktopStartup')}</h3>{monitors.length?<Select id="settings-monitor" label={t('settings.targetMonitor')} value={draft.targetMonitorId??monitors.find(item=>item.isPrimary)?.id??monitors[0].id} options={monitors.map(item=>({value:item.id,label:`${item.name}${item.isPrimary?t('settings.primaryMonitor'):''} · ${item.width}×${item.height} · ${Math.round(item.scaleFactor*100)}%`}))} onChange={value=>setDraft({...draft,targetMonitorId:value})}/>:null}<div className="settings-checks">
    <Check label={t('settings.restoreWallpaper')} checked={draft.wallpaperEnabled} onChange={toggle('wallpaperEnabled')}/><Check label={t('settings.launchAtLogin')} checked={draft.launchAtLogin} onChange={toggle('launchAtLogin')}/>
   </div></section>
   {error?<div className="dialog-error" role="alert">{error}</div>:null}
  </div>
 </Dialog>;
}
function Check({label,checked,onChange}:{label:string;checked:boolean;onChange:(event:React.ChangeEvent<HTMLInputElement>)=>void}){return <label className="form-check form-check-custom form-check-solid"><input className="form-check-input" type="checkbox" checked={checked} onChange={onChange}/><span className="form-check-label">{label}</span></label>}

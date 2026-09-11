import { X } from '../components/icons';
import type { IconStyle } from '../components/icon-style';
import { useEffect, useState } from 'react';
import { AssistantSettingsPanel } from '../assistant/AssistantSettingsPanel';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import { TabPanel, Tabs, type TabItem } from '../components/Tabs';
import type { AppSettings, MonitorInfo } from '../data/nowly-repository';
import { t, useTranslation, type Language } from '../i18n';

type Props={settings:AppSettings;monitors?:MonitorInfo[];onClose():void;onSave(settings:AppSettings):Promise<AppSettings>};
type SettingsTab='interface'|'desktop'|'model'|'quick-panel';
function errorMessage(error:unknown){return typeof error==='object'&&error!==null&&'message'in error&&typeof error.message==='string'?error.message:t('settings.saveError')}

export function SettingsDialog({settings,monitors=[],onClose,onSave}:Props){
 // Language switches in real time via the i18n store, independent of the save
 // button, so the whole UI updates the moment the user picks a language.
 const {language,setLanguage}=useTranslation();
 const [draft,setDraft]=useState(()=>({...settings, quickPanelEnabled: settings.quickPanelEnabled ?? true, quickPanelShortcut: settings.quickPanelShortcut ?? 'Ctrl+Space'})); const [saving,setSaving]=useState(false); const [error,setError]=useState<string|null>(null);
 const [tab,setTab]=useState<SettingsTab>('interface');
 const [shortcutError,setShortcutError]=useState<string|null>(null);
 // Resolve the monitor that should appear selected: the saved id when it still
 // matches a connected monitor, otherwise the primary (or first) one. Falling
 // back here rather than trusting the saved id blindly keeps the dropdown from
 // showing a blank placeholder when the saved monitor is gone or unset.
 const resolvedMonitorId=monitors.length?((draft.targetMonitorId&&monitors.some(item=>item.id===draft.targetMonitorId))?draft.targetMonitorId:monitors.find(item=>item.isPrimary)?.id??monitors[0].id):null;
 // Sync that resolved id back into the draft so saving persists exactly what
 // the dropdown shows, instead of a null or stale id.
 useEffect(()=>{if(resolvedMonitorId&&resolvedMonitorId!==draft.targetMonitorId)setDraft(current=>({...current,targetMonitorId:resolvedMonitorId}));},[resolvedMonitorId,draft.targetMonitorId]);
 const toggle=(key:keyof AppSettings)=>(event:React.ChangeEvent<HTMLInputElement>)=>setDraft(current=>({...current,[key]:event.target.checked}));
 async function save(){setSaving(true);setError(null);try{await onSave(draft);onClose();}catch(reason){setError(errorMessage(reason));}finally{setSaving(false)}}
 const tabs:TabItem<SettingsTab>[]=[{id:'interface',label:t('settings.interface')},{id:'desktop',label:t('settings.desktopStartup')},{id:'quick-panel',label:t('settings.quickPanel')},{id:'model',label:t('settings.model')}];
 function captureShortcut(event:React.KeyboardEvent<HTMLInputElement>) {
  if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
    if (/^[a-z0-9]$/i.test(event.key)) { event.preventDefault(); setShortcutError(t('settings.quickPanelShortcutModifier')); }
    return;
  }
  if (!/^[a-z0-9]$/i.test(event.key) && !['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',' '].includes(event.key)) return;
  event.preventDefault(); setShortcutError(null);
  const parts=[event.ctrlKey?'Ctrl':null,event.altKey?'Alt':null,event.shiftKey?'Shift':null,event.metaKey?'Super':null].filter(Boolean);
  const key=event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  setDraft(current=>({...current,quickPanelShortcut:[...parts,key].join('+')}));
 }
 return <Dialog title={t('settings.title')} ariaLabelledBy="settings-title" onRequestClose={onClose} className="settings-dialog" headerActions={<button className="good-icon-button" aria-label={t('settings.close')} onClick={onClose}><X aria-hidden="true"/></button>} footer={<><button className="good-button" onClick={onClose}>{t('common.cancel')}</button><button className="good-button good-button--primary" disabled={saving} onClick={()=>void save()}>{saving?t('common.saving'):t('settings.saveSettings')}</button></>}>
  <div className="settings-form">
   <Tabs idPrefix="settings" label={t('settings.title')} items={tabs} value={tab} onChange={setTab}/>
   <TabPanel idPrefix="settings" tabId="interface" active={tab==='interface'}>
    <div className="settings-grid">
     <Select id="settings-language" label={t('settings.language')} value={language} options={[{value:'zh',label:t('settings.langZh')},{value:'en',label:t('settings.langEn')}]} onChange={value=>setLanguage(value as Language)}/>
     <Select id="settings-density" label={t('settings.density')} value={draft.density} options={[{value:'compact',label:t('settings.densityCompact')},{value:'balanced',label:t('settings.densityBalanced')},{value:'comfortable',label:t('settings.densityComfortable')}]} onChange={value=>setDraft({...draft,density:value as AppSettings['density']})}/>
     <Select id="settings-icon-style" label={t('settings.iconStyle')} value={draft.iconStyle} options={[{value:'duotone',label:t('settings.iconStyleDuotone')},{value:'solid',label:t('settings.iconStyleSolid')},{value:'outline',label:t('settings.iconStyleOutline')}]} onChange={value=>setDraft({...draft,iconStyle:value as IconStyle})}/>
    </div>
    <div className="settings-checks">
     <Check label={t('settings.hideTopbarInWallpaper')} checked={draft.hideTopbarInWallpaper} onChange={toggle('hideTopbarInWallpaper')}/>
     <Check label={t('settings.quickPanelEnabled')} checked={draft.quickPanelEnabled ?? true} onChange={toggle('quickPanelEnabled')}/>
     <label className="settings-field"><span>{t('settings.quickPanelShortcut')}</span><input value={draft.quickPanelShortcut ?? 'Ctrl+Space'} onChange={e=>setDraft({...draft,quickPanelShortcut:e.target.value})} placeholder="Ctrl+Space" /></label>
    </div>
   </TabPanel>
   <TabPanel idPrefix="settings" tabId="quick-panel" active={tab==='quick-panel'}>
    <div className="settings-checks"><Check label={t('settings.quickPanelEnabled')} checked={draft.quickPanelEnabled ?? true} onChange={toggle('quickPanelEnabled')}/></div>
    <label className="settings-field"><span>{t('settings.quickPanelShortcut')}</span><input aria-label={t('settings.quickPanelShortcut')} value={draft.quickPanelShortcut ?? 'Ctrl+Space'} disabled={draft.quickPanelEnabled === false} onKeyDown={captureShortcut} onChange={()=>undefined}/></label>
    {shortcutError?<p className="dialog-error" role="alert">{shortcutError}</p>:null}
   </TabPanel>
   <TabPanel idPrefix="settings" tabId="desktop" active={tab==='desktop'}>
    {monitors.length?<Select id="settings-monitor" label={t('settings.targetMonitor')} value={resolvedMonitorId??''} options={monitors.map(item=>({value:item.id,label:`${item.name}${item.isPrimary?t('settings.primaryMonitor'):''} · ${item.width}×${item.height} · ${Math.round(item.scaleFactor*100)}%`}))} onChange={value=>setDraft({...draft,targetMonitorId:value})}/>:null}
    <div className="settings-checks">
     <Check label={t('settings.restoreWallpaper')} checked={draft.wallpaperEnabled} onChange={toggle('wallpaperEnabled')}/><Check label={t('settings.launchAtLogin')} checked={draft.launchAtLogin} onChange={toggle('launchAtLogin')}/>
    </div>
   </TabPanel>
   <TabPanel idPrefix="settings" tabId="model" active={tab==='model'}>
    <AssistantSettingsPanel/>
   </TabPanel>
   {error?<div className="dialog-error" role="alert">{error}</div>:null}
  </div>
 </Dialog>;
}
function Check({label,checked,onChange}:{label:string;checked:boolean;onChange:(event:React.ChangeEvent<HTMLInputElement>)=>void}){return <label className="form-check form-check-custom form-check-solid"><input className="form-check-input" type="checkbox" checked={checked} onChange={onChange}/><span className="form-check-label">{label}</span></label>}

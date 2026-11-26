import { X } from '../components/icons';
import type { IconStyle } from '../components/icon-style';
import { useEffect, useState } from 'react';
import { AssistantSettingsPanel } from '../assistant/AssistantSettingsPanel';
import { AssistantSetupSteps, type AssistantSetupStatus } from '../assistant/AssistantSetupSteps';
import { AgentSettingsPanel } from './AgentSettingsPanel';
import { BarMenuSettings } from './BarMenuSettings';
import { VoiceSettingsPanel } from './VoiceSettingsPanel';
import { SoundSettingsPanel } from './SoundSettingsPanel';
import { normalizeSoundSettings } from './sound-settings';
import { normalizeBarMenu } from '../app/bar-menu';
import { ShortcutRecorder, normalizeShortcut } from './ShortcutRecorder';
import './shortcut-settings.css';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import { TabPanel, Tabs, type TabItem } from '../components/Tabs';
import type { AppSettings, MonitorInfo } from '../data/nowly-repository';
import { t, useTranslation, SUPPORTED_LANGUAGES, LOCALES, type Language } from '../i18n';

/** Where the Bar's voice errors land: the model connection or the 语音输入 group. */
export type SettingsSection='model'|'voice';
type Props={settings:AppSettings;monitors?:MonitorInfo[];section?:SettingsSection;sectionRequest?:number;onClose():void;onSave(settings:AppSettings):Promise<AppSettings>};
type SettingsTab='interface'|'desktop'|'notifications'|'sound'|'shortcuts'|'model'|'agents';
type ShortcutField='screenshotShortcut'|'screenshotHistoryShortcut'|'quickCreateEventShortcut'|'quickCreateTaskShortcut'|'quickCreateNoteShortcut';
const QUICK_CREATE_SHORTCUTS=[
 {field:'quickCreateEventShortcut',id:'settings-quick-create-event-shortcut',label:'settings.quickCreateEventShortcut'},
 {field:'quickCreateTaskShortcut',id:'settings-quick-create-task-shortcut',label:'settings.quickCreateTaskShortcut'},
 {field:'quickCreateNoteShortcut',id:'settings-quick-create-note-shortcut',label:'settings.quickCreateNoteShortcut'}
] as const;
const SHORTCUT_FIELDS:readonly ShortcutField[]=['screenshotShortcut','screenshotHistoryShortcut',...QUICK_CREATE_SHORTCUTS.map(item=>item.field)];
function errorMessage(error:unknown){return typeof error==='object'&&error!==null&&'message'in error&&typeof error.message==='string'?error.message:t('settings.saveError')}

export function SettingsDialog({settings,monitors=[],section,sectionRequest,onClose,onSave}:Props){
 // Language switches in real time via the i18n store, independent of the save
 // button, so the whole UI updates the moment the user picks a language.
 const {language,setLanguage}=useTranslation();
 const [draft,setDraft]=useState(()=>({...settings, soundSettings: normalizeSoundSettings(settings.soundSettings), barMenu: normalizeBarMenu(settings.barMenu), notificationMode: settings.notificationMode ?? 'notification', quickPanelEnabled: true, quickPanelShortcut: settings.quickPanelShortcut ?? 'Ctrl+Space', screenshotShortcut: settings.screenshotShortcut ?? 'Ctrl+Alt+A', screenshotHistoryShortcut: settings.screenshotHistoryShortcut ?? 'Ctrl+Alt+H', quickCreateEventShortcut: settings.quickCreateEventShortcut ?? '', quickCreateTaskShortcut: settings.quickCreateTaskShortcut ?? '', quickCreateNoteShortcut: settings.quickCreateNoteShortcut ?? ''})); const [saving,setSaving]=useState(false); const [error,setError]=useState<string|null>(null);
 const [tab,setTab]=useState<SettingsTab>(section?'model':'interface');
 const [setup,setSetup]=useState<AssistantSetupStatus>({model:null,data:null,voice:null});
 useEffect(()=>{if(section)setTab('model');},[section,sectionRequest]);
 // Resolve the monitor that should appear selected: the saved id when it still
 // matches a connected monitor, otherwise the primary (or first) one. Falling
 // back here rather than trusting the saved id blindly keeps the dropdown from
 // showing a blank placeholder when the saved monitor is gone or unset.
 const resolvedMonitorId=monitors.length?((draft.targetMonitorId&&monitors.some(item=>item.id===draft.targetMonitorId))?draft.targetMonitorId:monitors.find(item=>item.isPrimary)?.id??monitors[0].id):null;
 // Sync that resolved id back into the draft so saving persists exactly what
 // the dropdown shows, instead of a null or stale id.
 useEffect(()=>{if(resolvedMonitorId&&resolvedMonitorId!==draft.targetMonitorId)setDraft(current=>({...current,targetMonitorId:resolvedMonitorId}));},[resolvedMonitorId,draft.targetMonitorId]);
 const toggle=(key:keyof AppSettings)=>(event:React.ChangeEvent<HTMLInputElement>)=>setDraft(current=>({...current,[key]:event.target.checked}));
 const others=(field:ShortcutField)=>SHORTCUT_FIELDS.filter(other=>other!==field).map(other=>draft[other]);
 async function save(){
  const shortcuts=SHORTCUT_FIELDS.map(field=>draft[field].trim()?normalizeShortcut(draft[field]):'');
  if(shortcuts.some(value=>value===null)){setError(t('settings.shortcutInvalid'));return;}
  const bound=shortcuts.filter(Boolean);
  if(new Set(bound).size!==bound.length){setError(t('settings.shortcutDuplicate'));return;}
  const [screenshotShortcut,screenshotHistoryShortcut,quickCreateEventShortcut,quickCreateTaskShortcut,quickCreateNoteShortcut]=shortcuts as string[];
  setSaving(true);setError(null);try{await onSave({...draft,screenshotShortcut,screenshotHistoryShortcut,quickCreateEventShortcut,quickCreateTaskShortcut,quickCreateNoteShortcut,quickPanelEnabled:true});onClose();}catch(reason){setError(typeof reason==='object'&&reason!==null&&'field'in reason&&(SHORTCUT_FIELDS as readonly string[]).includes(String(reason.field))?t('settings.shortcutConflict'):errorMessage(reason));}finally{setSaving(false)}
 }
 const tabs:TabItem<SettingsTab>[]=[{id:'interface',label:t('settings.interface')},{id:'desktop',label:t('settings.desktopStartup')},{id:'notifications',label:t('settings.notifications')},{id:'sound',label:t('settings.sound')},{id:'shortcuts',label:t('settings.shortcuts')},{id:'model',label:t('settings.model')},{id:'agents',label:t('agents.tab')}];
 return <Dialog title={t('settings.title')} ariaLabelledBy="settings-title" onRequestClose={onClose} className="settings-dialog" headerActions={<button className="good-icon-button" aria-label={t('settings.close')} onClick={onClose}><X aria-hidden="true"/></button>} footer={<><button className="good-button" onClick={onClose}>{t('common.cancel')}</button><button className="good-button good-button--primary" disabled={saving} onClick={()=>void save()}>{saving?t('common.saving'):t('settings.saveSettings')}</button></>}>
  <div className="settings-form">
   <Tabs idPrefix="settings" label={t('settings.title')} items={tabs} value={tab} onChange={setTab}/>
   <TabPanel idPrefix="settings" tabId="interface" active={tab==='interface'}>
    <div className="settings-grid">
     <Select id="settings-language" label={t('settings.language')} value={language} options={SUPPORTED_LANGUAGES.map(value=>({value,label:LOCALES[value].name}))} onChange={value=>setLanguage(value as Language)}/>
     <Select id="settings-density" label={t('settings.density')} value={draft.density} options={[{value:'compact',label:t('settings.densityCompact')},{value:'balanced',label:t('settings.densityBalanced')},{value:'comfortable',label:t('settings.densityComfortable')}]} onChange={value=>setDraft({...draft,density:value as AppSettings['density']})}/>
     <Select id="settings-icon-style" label={t('settings.iconStyle')} value={draft.iconStyle} options={[{value:'duotone',label:t('settings.iconStyleDuotone')},{value:'solid',label:t('settings.iconStyleSolid')},{value:'outline',label:t('settings.iconStyleOutline')}]} onChange={value=>setDraft({...draft,iconStyle:value as IconStyle})}/>
    </div>
    <fieldset className="settings-wallpaper">
     <legend>{t('settings.wallpaperAppearance')}</legend>
     <p>{t('settings.wallpaperAppearanceHint')}</p>
     <div className="settings-checks">
      <Check label={t('settings.hideTopbarInWallpaper')} checked={draft.hideTopbarInWallpaper} onChange={toggle('hideTopbarInWallpaper')}/>
      <Check label={t('settings.hideModuleBackgroundInWallpaper')} checked={draft.hideModuleBackgroundInWallpaper ?? false} onChange={toggle('hideModuleBackgroundInWallpaper')}/>
     </div>
    </fieldset>
   </TabPanel>
   <TabPanel idPrefix="settings" tabId="notifications" active={tab==='notifications'}>
    <div className="settings-grid">
     <Select id="settings-notification-mode" label={t('settings.notificationMode')} value={draft.notificationMode ?? 'notification'} options={[{value:'persistent',label:t('settings.notificationModePersistent')},{value:'notification',label:t('settings.notificationModeNotification')}]} onChange={value=>setDraft({...draft,notificationMode:value as NonNullable<AppSettings['notificationMode']>})}/>
    </div>
    <BarMenuSettings menu={draft.barMenu} onChange={barMenu=>setDraft(current=>({...current,barMenu}))}/>
   </TabPanel>
   <TabPanel idPrefix="settings" tabId="sound" active={tab==='sound'}>
    <SoundSettingsPanel value={draft.soundSettings} onChange={soundSettings=>setDraft(current=>({...current,soundSettings}))}/>
   </TabPanel>
   <TabPanel idPrefix="settings" tabId="desktop" active={tab==='desktop'}>
    {monitors.length?<Select id="settings-monitor" label={t('settings.targetMonitor')} value={resolvedMonitorId??''} options={monitors.map(item=>({value:item.id,label:`${item.name}${item.isPrimary?t('settings.primaryMonitor'):''} · ${item.width}×${item.height} · ${Math.round(item.scaleFactor*100)}%`}))} onChange={value=>setDraft({...draft,targetMonitorId:value})}/>:null}
    <div className="settings-checks">
     <Check label={t('settings.restoreWallpaper')} checked={draft.wallpaperEnabled} onChange={toggle('wallpaperEnabled')}/><Check label={t('settings.launchAtLogin')} checked={draft.launchAtLogin} onChange={toggle('launchAtLogin')}/>
    </div>
   </TabPanel>
   <TabPanel idPrefix="settings" tabId="shortcuts" active={tab==='shortcuts'}>
    <div className="shortcut-settings">
     <ShortcutRecorder id="settings-screenshot-shortcut" label={t('settings.screenshotShortcut')} value={draft.screenshotShortcut} otherValues={others('screenshotShortcut')} optional disabled={saving} onChange={screenshotShortcut=>setDraft(current=>({...current,screenshotShortcut}))}/>
     <ShortcutRecorder id="settings-history-shortcut" label={t('settings.screenshotHistoryShortcut')} value={draft.screenshotHistoryShortcut} otherValues={others('screenshotHistoryShortcut')} optional disabled={saving} onChange={screenshotHistoryShortcut=>setDraft(current=>({...current,screenshotHistoryShortcut}))}/>
     <fieldset className="shortcut-settings__group">
      <legend>{t('barMenu.groupCreate')}</legend>
      <p>{t('settings.quickCreateShortcutHint')}</p>
      {QUICK_CREATE_SHORTCUTS.map(({field,id,label})=><ShortcutRecorder key={field} id={id} label={t(label)} value={draft[field]} otherValues={others(field)} optional disabled={saving} onChange={value=>setDraft(current=>({...current,[field]:value}))}/>)}
     </fieldset>
    </div>
   </TabPanel>
   <TabPanel idPrefix="settings" tabId="model" active={tab==='model'}>
    <div className="settings-model">
     <AssistantSetupSteps status={setup}/>
     <AssistantSettingsPanel onStatusChange={status=>setSetup(current=>({...current,...status}))}/>
     <VoiceSettingsPanel takenShortcuts={SHORTCUT_FIELDS.map(field=>draft[field]).filter(Boolean)} focusRequest={section==='voice'&&tab==='model'?sectionRequest??0:undefined} onStatusChange={voice=>setSetup(current=>({...current,voice}))}/>
    </div>
   </TabPanel>
   <TabPanel idPrefix="settings" tabId="agents" active={tab==='agents'}>
    <AgentSettingsPanel/>
   </TabPanel>
   {error?<div className="dialog-error" role="alert">{error}</div>:null}
  </div>
 </Dialog>;
}
function Check({label,checked,onChange}:{label:string;checked:boolean;onChange:(event:React.ChangeEvent<HTMLInputElement>)=>void}){return <label className="form-check form-check-custom form-check-solid"><input className="form-check-input" type="checkbox" checked={checked} onChange={onChange}/><span className="form-check-label">{label}</span></label>}

import { useEffect, useState, type KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../i18n';

const modifiers = ['Ctrl', 'Alt', 'Shift', 'Super'];
export function normalizeShortcut(value: string): string | null {
  const parts = value.split('+').map(part => part.trim());
  const found = new Set<string>();
  let key: string | undefined;
  for (const part of parts) {
    const modifier = ({ctrl:'Ctrl',control:'Ctrl',alt:'Alt',shift:'Shift',super:'Super',meta:'Super'} as Record<string,string>)[part.toLowerCase()];
    if (modifier) { if (found.has(modifier)) return null; found.add(modifier); }
    else if (!key && /^(?:[a-z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/i.test(part)) key = part.toUpperCase();
    else return null;
  }
  return found.size && key ? [...modifiers.filter(modifier => found.has(modifier)), key].join('+') : null;
}

type Props = {id:string;label:string;value:string;otherValue?:string;disabled?:boolean;onChange(value:string):void};
export function ShortcutRecorder({id,label,value,otherValue,disabled,onChange}: Props) {
  const [error,setError] = useState<string|null>(null);
  const [recording,setRecording] = useState(false);
  useEffect(()=>{if(!recording)return;void invoke('screenshot_shortcut_recording',{recording:true}).catch(()=>{});return()=>{void invoke('screenshot_shortcut_recording',{recording:false}).catch(()=>{});};},[recording]);
  function record(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === 'Tab') return;
    event.preventDefault();
    if (event.repeat || ['Control','Alt','Shift','Meta'].includes(event.key)) return;
    if (event.key === 'Escape') { event.currentTarget.blur(); setError(null); return; }
    const code = /^(?:Key[A-Z]|Digit[0-9])$/.test(event.code) ? event.code.replace(/^(?:Key|Digit)/,'') : event.code;
    const shortcut = normalizeShortcut([event.ctrlKey?'Ctrl':'', event.altKey?'Alt':'', event.shiftKey?'Shift':'', event.metaKey?'Super':'', code].filter(Boolean).join('+'));
    if (!shortcut) { setError(t('settings.shortcutInvalid')); return; }
    if (shortcut === normalizeShortcut(otherValue ?? '')) { setError(t('settings.shortcutDuplicate')); return; }
    setError(null); onChange(shortcut);
  }
  return <div className="shortcut-recorder"><label htmlFor={id}>{label}</label><input id={id} readOnly value={value} disabled={disabled} onFocus={()=>setRecording(true)} onBlur={()=>setRecording(false)} onKeyDown={record} onKeyUp={event=>{if(event.key!=='Tab') {event.preventDefault();event.stopPropagation();}}} aria-invalid={!!error} aria-describedby={`${id}-hint${error?` ${id}-error`:''}`}/><p id={`${id}-hint`} className="shortcut-recorder__hint">{t('settings.shortcutRecordHint')}</p>{error?<p id={`${id}-error`} className="dialog-error" role="alert">{error}</p>:null}</div>;
}

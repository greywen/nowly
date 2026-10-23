import { useEffect, useState, type KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X } from '../components/icons';
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

type Props = {
  id: string;
  label: string;
  value: string;
  /** Bindings of the other shortcuts; a recording that matches one is rejected. */
  otherValues?: readonly string[];
  /** Optional shortcuts may stay unset and offer a clear action. */
  optional?: boolean;
  disabled?: boolean;
  onChange(value: string): void;
};
export function ShortcutRecorder({id,label,value,otherValues=[],optional=false,disabled,onChange}: Props) {
  const [error,setError] = useState<string|null>(null);
  const [recording,setRecording] = useState(false);
  useEffect(()=>{if(!recording)return;void invoke('screenshot_shortcut_recording',{recording:true}).catch(()=>{});return()=>{void invoke('screenshot_shortcut_recording',{recording:false}).catch(()=>{});};},[recording]);
  function clear() { setError(null); onChange(''); }
  function record(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === 'Tab') return;
    event.preventDefault();
    if (event.repeat || ['Control','Alt','Shift','Meta'].includes(event.key)) return;
    if (event.key === 'Escape') { event.currentTarget.blur(); setError(null); return; }
    const modified = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
    if (optional && !modified && (event.key === 'Backspace' || event.key === 'Delete')) { clear(); return; }
    const code = /^(?:Key[A-Z]|Digit[0-9])$/.test(event.code) ? event.code.replace(/^(?:Key|Digit)/,'') : event.code;
    const shortcut = normalizeShortcut([event.ctrlKey?'Ctrl':'', event.altKey?'Alt':'', event.shiftKey?'Shift':'', event.metaKey?'Super':'', code].filter(Boolean).join('+'));
    if (!shortcut) { setError(t('settings.shortcutInvalid')); return; }
    if (otherValues.some(other => normalizeShortcut(other) === shortcut)) { setError(t('settings.shortcutDuplicate')); return; }
    setError(null); onChange(shortcut);
  }
  const input = <input id={id} readOnly value={value} disabled={disabled} placeholder={optional ? t('settings.shortcutNotSet') : undefined} onFocus={()=>setRecording(true)} onBlur={()=>setRecording(false)} onKeyDown={record} onKeyUp={event=>{if(event.key!=='Tab') {event.preventDefault();event.stopPropagation();}}} aria-invalid={!!error} aria-describedby={error?`${id}-error`:undefined}/>;
  return <div className="shortcut-recorder"><label htmlFor={id}>{label}</label>{optional ? <div className="shortcut-recorder__field">{input}<button type="button" className="good-icon-button" aria-label={t('settings.shortcutClearLabel',{feature:label})} title={t('settings.shortcutClearLabel',{feature:label})} disabled={disabled || !value} onClick={clear}><X aria-hidden="true"/></button></div> : input}{error?<p id={`${id}-error`} className="dialog-error" role="alert">{error}</p>:null}</div>;
}

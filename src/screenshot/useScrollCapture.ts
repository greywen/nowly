import { useState,useEffect,useCallback,useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { acceptScrollUpdate,type ScrollState } from './scroll-model';
export function useScrollCapture(onAdopt?:(state:ScrollState)=>void) {
 const [state,setState]=useState<ScrollState|null>(null);const [error,setError]=useState<string|null>(null);const [preview,setPreview]=useState<string|null>(null);const ref=useRef(state);ref.current=state;const generation=useRef(0);const busy=useRef(false);
 useEffect(()=>{let active=true;let stop:(()=>void)|undefined;void listen<ScrollState>('screenshot-scroll-state',e=>{if(active)setState(s=>e.payload.phase==='cancelled' ? (s && (s.sessionId!==e.payload.sessionId || s.revision>e.payload.revision) ? s : null) : acceptScrollUpdate(s,e.payload));}).then(s=>{if(active)stop=s;else s();});return()=>{active=false;generation.current++;busy.current=false;stop?.();};},[]);
 useEffect(()=>{if(!state || !state.height)return;let active=true;let url:string|undefined;void invoke<ArrayBuffer>('scroll_capture_image',{revision:state.revision}).then(bytes=>{if(!active)return;url=URL.createObjectURL(new Blob([new Uint8Array(bytes)]));setPreview(url);}).catch(()=>{});return()=>{active=false;if(url)URL.revokeObjectURL(url);};},[state?.revision,state?.height]);
 const command=useCallback(async(action:string,extra:Record<string,unknown>={})=>{if(busy.current)return;busy.current=true;const epoch=generation.current;setError(null);try {const result=await invoke<ScrollState|null>('scroll_capture',{action,revision:action==='prepare'?null:ref.current?.revision,...extra});if(epoch!==generation.current)return;if(action==='adopt' && result){onAdopt?.(result);setState(null);}else if(action==='discard'){generation.current++;busy.current=false;setState(null);setPreview(null);}else setState(s=>result?acceptScrollUpdate(s,result):null);}catch(e){if(epoch===generation.current)setError(String(e));}finally{if(epoch===generation.current)busy.current=false;}},[onAdopt]);
 return {state,error,preview,command};
}

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { FocusPeriodBoundary, FocusSession, FocusStatistics } from '../data/nowly-repository';
import { completeFocus, dismissFullscreen, focusedMilliseconds, initialFocusState, interruptFocus, pauseFocus, remainingSeconds as deriveRemaining, requestFullscreen, resumeFocus, snapshotFocus, startFocus, type FocusState } from './focus-model';

type StatisticsResource={status:'loading'|'ready'|'error';data:FocusStatistics;message?:string};
type FocusApi={state:FocusState;remainingSeconds:number;focusedSeconds:number;statistics:StatisticsResource;start(minutes?:number):Promise<void>;pause():Promise<void>;resume():Promise<void>;interrupt():Promise<void>;enterFullscreen():void;exitFullscreen():void;loadStatistics(boundaries?:FocusPeriodBoundary[]):Promise<void>};
const empty:FocusStatistics={totalFocusedSeconds:0,completedCount:0,interruptedCount:0,completionRate:0,points:[]};
const Context=createContext<FocusApi|null>(null);

export function dailyBoundaries(days:number,date=new Date()):FocusPeriodBoundary[]{
  const result:FocusPeriodBoundary[]=[];
  const cursor=new Date(date.getFullYear(),date.getMonth(),date.getDate()-days+1);
  for(let index=0;index<days;index+=1){const start=new Date(cursor);const end=new Date(cursor);end.setDate(end.getDate()+1);result.push({period:`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`,startAt:start.toISOString(),endAtExclusive:end.toISOString()});cursor.setDate(cursor.getDate()+1);}
  return result;
}

export function FocusTimerProvider({children}:{children:ReactNode}){
  const repository=useNowlyRepository();
  const [state,setState]=useState(()=>initialFocusState(25));
  const stateRef=useRef(state);stateRef.current=state;
  const [nowMono,setNowMono]=useState(()=>performance.now());
  const [statistics,setStatistics]=useState<StatisticsResource>({status:'loading',data:empty});
  useEffect(()=>{if(state.status!=='running')return;const id=window.setInterval(()=>setNowMono(performance.now()),1000);return()=>clearInterval(id)},[state.status]);

  async function loadStatistics(boundaries=dailyBoundaries(7)){setStatistics(current=>({...current,status:'loading'}));try{setStatistics({status:'ready',data:await repository.getFocusStatistics(boundaries)})}catch(error){setStatistics({status:'error',data:empty,message:error instanceof Error?error.message:'error'})}}
  useEffect(()=>{void loadStatistics();},[]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{void invoke<{id:string;plannedSeconds:number;startedAt:string}|null>('get_pending_focus_completion').then(async pending=>{if(!pending)return;const endedAt=new Date().toISOString();const record:FocusSession={id:pending.id,plannedSeconds:pending.plannedSeconds,focusedSeconds:pending.plannedSeconds,status:'completed',startedAt:pending.startedAt,endedAt,createdAt:endedAt};await repository.createFocusSession(record);await invoke('acknowledge_focus_completion',{id:pending.id});await loadStatistics()}).catch(()=>undefined)},[repository]);// eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{let remove=()=>{};void listen<{id:string;plannedSeconds:number;startedAt:string}>('focus-session-completed',event=>{const current=stateRef.current;if(current.sessionId!==event.payload.id)return;const completed=completeFocus(current,performance.now());setState(completed);const record={...snapshotFocus(completed,performance.now(),Date.now()),focusedSeconds:completed.plannedSeconds,status:'completed' as const};void repository.createFocusSession(record).then(()=>invoke('acknowledge_focus_completion',{id:record.id})).then(()=>loadStatistics())}).then(unlisten=>{remove=unlisten});return()=>remove()},[repository]);

  async function start(minutes=state.plannedSeconds/60){const idle=initialFocusState(minutes);const next=startFocus(idle,{id:crypto.randomUUID(),nowWallMs:Date.now(),nowMonoMs:performance.now()});setState(next);await invoke('start_focus_timer',{snapshot:{id:next.sessionId,plannedSeconds:next.plannedSeconds,startedAt:next.startedAt,notificationTitle:'专注完成',notificationBody:`你已完成 ${minutes} 分钟专注，休息一下吧。`},remainingSeconds:next.plannedSeconds})}
  async function pause(){const next=pauseFocus(stateRef.current,performance.now());setState(next);if(next!==stateRef.current)await invoke('pause_focus_timer')}
  async function resume(){const next=resumeFocus(stateRef.current,performance.now());setState(next);if(next!==stateRef.current)await invoke('resume_focus_timer')}
  async function interrupt(){const result=interruptFocus(stateRef.current,performance.now(),Date.now());setState(result.state);await invoke('cancel_focus_timer');if(result.record){await repository.createFocusSession(result.record as FocusSession);await loadStatistics()}}
  const value=useMemo<FocusApi>(()=>({state,remainingSeconds:deriveRemaining(state,nowMono),focusedSeconds:Math.floor(focusedMilliseconds(state,nowMono)/1000),statistics,start,pause,resume,interrupt,enterFullscreen:()=>setState(current=>requestFullscreen(current)),exitFullscreen:()=>setState(current=>dismissFullscreen(current)),loadStatistics}),[state,nowMono,statistics]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useFocusTimer(){const value=useContext(Context);if(!value)throw new Error('useFocusTimer must be used inside FocusTimerProvider');return value}

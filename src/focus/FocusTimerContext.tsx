import { invoke } from '@tauri-apps/api/core';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { FocusPeriodBoundary, FocusSession, FocusStatistics } from '../data/nowly-repository';
import { t, useTranslation } from '../i18n';
import { useNativeFocusSnapshot, type NativeFocusStatusSnapshot } from './useNativeFocusSnapshot';
import { focusedMilliseconds, initialFocusState, interruptFocus, pauseFocus, remainingSeconds as deriveRemaining, resumeFocus, startFocus, type FocusState } from './focus-model';

type StatisticsResource={status:'loading'|'ready'|'error';data:FocusStatistics;message?:string};
type FocusApi={state:FocusState;remainingSeconds:number;focusedSeconds:number;todayFocusedSeconds:number;statistics:StatisticsResource;start(minutes?:number):Promise<void>;pause():Promise<void>;resume():Promise<void>;interrupt():Promise<void>;reset():void;loadStatistics(boundaries?:FocusPeriodBoundary[]):Promise<void>};
const empty:FocusStatistics={totalFocusedSeconds:0,completedCount:0,interruptedCount:0,completionRate:0,points:[]};
const Context=createContext<FocusApi|null>(null);

export function dailyBoundaries(days:number,date=new Date()):FocusPeriodBoundary[]{
  const result:FocusPeriodBoundary[]=[];
  const cursor=new Date(date.getFullYear(),date.getMonth(),date.getDate()-days+1);
  for(let index=0;index<days;index+=1){const start=new Date(cursor);const end=new Date(cursor);end.setDate(end.getDate()+1);result.push({period:`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`,startAt:start.toISOString(),endAtExclusive:end.toISOString()});cursor.setDate(cursor.getDate()+1);}
  return result;
}

export function FocusTimerProvider({children}:{children:ReactNode}){
  useTranslation();
  const repository=useNowlyRepository();
  const [state,setState]=useState(()=>initialFocusState(25));
  const stateRef=useRef(state);stateRef.current=state;
  const native = useNativeFocusSnapshot();
  const nowMono = state.runStartedMonoMs ?? 0;
  const [statistics,setStatistics]=useState<StatisticsResource>({status:'loading',data:empty});
  // Today's focus time is tracked apart from the statistics resource: the stats
  // dialog reloads that resource with different period granularities, so the
  // topbar reads a dedicated single-day total that never shifts under it.
  const [todayRecordedSeconds,setTodayRecordedSeconds]=useState(0);
  useEffect(() => {
    if (!native) return;
    setState(current => native.status === 'idle'
      ? (current.status === 'completed' ? current : initialFocusState(current.plannedSeconds / 60))
      : {
        status: native.status,
        sessionId: native.sessionId,
        plannedSeconds: native.plannedSeconds,
        accumulatedMs: native.focusedSeconds * 1000,
        runStartedMonoMs: native.status === 'running' ? performance.now() : null,
        startedAt: native.startedAt
      });
  }, [native]);

  async function loadStatistics(boundaries=dailyBoundaries(7)){setStatistics(current=>({...current,status:'loading'}));try{setStatistics({status:'ready',data:await repository.getFocusStatistics(boundaries)})}catch(error){setStatistics({status:'error',data:empty,message:error instanceof Error?error.message:'error'})}}
  async function loadToday(){try{const stats=await repository.getFocusStatistics(dailyBoundaries(1));setTodayRecordedSeconds(stats.totalFocusedSeconds)}catch{/* keep the last known value */}}
  useEffect(()=>{void loadStatistics();void loadToday();},[]);// eslint-disable-line react-hooks/exhaustive-deps
  const savedCompletions = useRef(new Set<string>());
  async function recordCompletion(pending:{id:string;plannedSeconds:number;startedAt:string}){
    if(savedCompletions.current.has(pending.id))return;
    savedCompletions.current.add(pending.id);
    try{
      const endedAt=new Date().toISOString();
      const record:FocusSession={id:pending.id,plannedSeconds:pending.plannedSeconds,focusedSeconds:pending.plannedSeconds,status:'completed',startedAt:pending.startedAt,endedAt,createdAt:endedAt};
      await repository.createFocusSession(record);
      await invoke('acknowledge_focus_completion',{id:pending.id});
      await loadStatistics();
      await loadToday();
    }catch{savedCompletions.current.delete(pending.id)}
  }
  useEffect(()=>{void invoke<{id:string;plannedSeconds:number;startedAt:string}|null>('get_pending_focus_completion').then(pending=>{if(pending)void recordCompletion(pending)}).catch(()=>undefined)},[repository]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    if(native?.status==='completed' && native.sessionId && native.startedAt){
      void recordCompletion({id:native.sessionId,plannedSeconds:native.plannedSeconds,startedAt:native.startedAt});
    }
  },[native]);// eslint-disable-line react-hooks/exhaustive-deps


  async function start(minutes=state.plannedSeconds/60){const idle=initialFocusState(minutes);const next=startFocus(idle,{id:crypto.randomUUID(),nowWallMs:Date.now(),nowMonoMs:performance.now()});setState(next);await invoke('start_focus_timer',{snapshot:{id:next.sessionId,plannedSeconds:next.plannedSeconds,startedAt:next.startedAt,notificationTitle:t('focusTimer.notificationTitle'),notificationBody:t('focusTimer.notificationBody',{minutes})},remainingSeconds:next.plannedSeconds})}
  async function pause(){const next=pauseFocus(stateRef.current,stateRef.current.runStartedMonoMs ?? 0);setState(next);if(next!==stateRef.current)await invoke('pause_focus_timer')}
  async function resume(){const next=resumeFocus(stateRef.current,performance.now());setState(next);if(next!==stateRef.current)await invoke('resume_focus_timer')}
  async function interrupt(){
    const current=stateRef.current;
    const sample=await invoke<NativeFocusStatusSnapshot|null>('get_focus_timer_snapshot');
    if(sample?.status==='completed')return;
    const sampledState=sample && sample.sessionId===current.sessionId
      ? {...current,accumulatedMs:sample.focusedSeconds*1000,runStartedMonoMs:null}
      : current;
    const result=interruptFocus(sampledState,sampledState.runStartedMonoMs ?? 0,Date.now());
    await invoke('cancel_focus_timer');
    setState(result.state);
    if(result.record){await repository.createFocusSession(result.record as FocusSession);await loadStatistics();await loadToday()}
  }
  // Return a finished session to the idle preview. Only a completed session is
  // cleared so this can never cut short a running or paused timer. Keeping the
  // planned duration means the next session and the wallpaper countdown start
  // clean instead of showing a stale 00:00.
  function reset(){setState(current=>current.status==='completed'?initialFocusState(current.plannedSeconds/60):current)}
  const value=useMemo<FocusApi>(()=>{const liveSeconds=state.status==='running'||state.status==='paused'?Math.floor(focusedMilliseconds(state,nowMono)/1000):0;return{state,remainingSeconds:native && native.sessionId === state.sessionId && native.status === state.status ? native.remainingSeconds : deriveRemaining(state,nowMono),focusedSeconds:Math.floor(focusedMilliseconds(state,nowMono)/1000),todayFocusedSeconds:todayRecordedSeconds+liveSeconds,statistics,start,pause,resume,interrupt,reset,loadStatistics}},[state,nowMono,native,statistics,todayRecordedSeconds]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useFocusTimer(){const value=useContext(Context);if(!value)throw new Error('useFocusTimer must be used inside FocusTimerProvider');return value}

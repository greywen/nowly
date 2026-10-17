import { ScrollReview } from './ScrollReview';
import { useTranslation } from '../i18n';
import type { ScrollState } from './scroll-model';
export function ScrollCapturePanel({state,command,preview,error}:{state:ScrollState;command:(action:string,extra?:Record<string,unknown>)=>void;preview?:string|null;error?:string|null}) {
 const {t}=useTranslation();
 return <section className="scroll-capture" aria-label={t('screenshot.auto.title')} onPointerDown={e=>e.stopPropagation()}>
 <h2>{t('screenshot.auto.title')}</h2>
 <p role="status">{state.phase==='prepare'?t('screenshot.auto.prepare'):state.phase==='capturing'?t(state.height?'screenshot.auto.scrolling':'screenshot.auto.initial'):`${state.width} × ${state.height} · ${state.phase}`}</p>
 {state.height>0?<p>{state.width} × {state.height}</p>:null}
 {state.reason?<p>{state.reason}</p>:null}{error?<p role="alert">{error}</p>:null}
 {preview?<ScrollReview src={preview} seams={state.seams}/>:null}
 <div className="scroll-capture__actions">
 {state.phase==='prepare'?<button onClick={()=>command('start')}>{t('screenshot.auto.start')}</button>:null}
 {state.phase==='capturing'?<button onClick={()=>command('pause')}>{t('screenshot.auto.pause')}</button>:null}
 {state.phase==='paused'?<button onClick={()=>command('continue')}>{t('screenshot.auto.continue')}</button>:null}
 {state.phase==='capturing'||state.phase==='paused'?<button onClick={()=>command('stop')}>{t('screenshot.auto.stop')}</button>:null}
 {state.phase==='review' && state.height>0?<button onClick={()=>command('adopt')}>{t(state.reason?.startsWith('Stopped')?'screenshot.auto.use':'screenshot.auto.partial')}</button>:null}
 <button onClick={()=>command('discard')}>{t('screenshot.auto.discard')}</button></div>
 <p>{t('screenshot.auto.note')}</p></section>;
}

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, History, MessageCircle, Mic, Send, Sparkles, Square } from 'lucide-react';
import { assistantClient, assistantError } from './client';
import { AssistantChat } from './AssistantChat';
import { AssistantHistory, historyCount, type HistoryRange } from './AssistantHistory';
import type { Action, AssistantClient, AssistantConfig, AssistantRecord, ChatItem, Fields, HistoryMessage, Plan } from './types';
import { connectionReady } from './types';
import './assistant.css';
export type AssistantDockProps = {
  client?: AssistantClient;
  active?: boolean;
  onRefresh: () => void | Promise<unknown>;
  onOpenSettings?: () => void;
  onOpenRecord?: (record: AssistantRecord, trigger: HTMLElement) => void | Promise<void>;
};
// Minimal shape of the Web Speech API; the DOM lib does not declare it and the
// dock only needs one final transcript per dictation.
type SpeechResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void;
  onresult: ((event: SpeechResultEvent) => void) | null; onerror: (() => void) | null; onend: (() => void) | null;
};
function speechRecognition(): (new () => Recognition) | null {
  const scope = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}
function upsertPlanItem(items: ChatItem[], next: Plan): ChatItem[] {
  const existing = items.findIndex(item => item.kind === 'plan' && item.plan.id === next.id);
  if (existing < 0) return [...items, { id: `plan:${next.id}`, kind: 'plan', plan: next }];
  return items.map((item, index) => index === existing && item.kind === 'plan' ? { ...item, plan: next } : item);
}
type PanelSurface = 'chat' | 'history';
export function AssistantDock({ client = assistantClient, active = true, onRefresh, onOpenSettings, onOpenRecord }: AssistantDockProps) {
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const dockRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputFocusedRef = useRef(false);
  const [draft, setDraft] = useState(''); const [expanded, setExpanded] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null); const planRef = useRef<Plan | null>(null);
  const [actions, setActions] = useState<Action[]>([]); const [selected, setSelected] = useState<boolean[]>([]);
  const [edits, setEdits] = useState<Fields[]>([]);
  const [dirty, setDirty] = useState(false); const dirtyRef = useRef(false);
  const [blocked, setBlocked] = useState(false); const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); const [reading, setReading] = useState(false);
  const requestRef = useRef<string | null>(null); const generation = useRef(0);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [history, setHistory] = useState<Plan[] | null>(null);
  const [historyRange, setHistoryRange] = useState<HistoryRange>('7');
  const [openChange, setOpenChange] = useState<string | null>(null);
  const historyMessages = useRef<HistoryMessage[]>([]);
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [surface, setSurface] = useState<PanelSurface>('chat');
  const historyReturnExpanded = useRef(false);
  const [uncertain, setUncertain] = useState<{ id: string; undo: boolean; preserveCurrent: boolean } | null>(null);
  const [listening, setListening] = useState(false); const recognitionRef = useRef<Recognition | null>(null);
  const activeRef = useRef(active); activeRef.current = active;
  const mounted = useRef(true);
  const [, tick] = useState(0);

  // Re-read the config whenever the dock comes back: connection settings now
  // live in the global settings dialog, which hides the dock while it is open.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void client.getConfig().then(c => {
      if (alive) {
        setConfig(c); setConnectionError('');
        if (inputFocusedRef.current && connectionReady(c)) showChat();
      }
    })
      .catch(() => { if (alive) setConnectionError('AI 连接尚不可用。请在 Nowly 桌面版中打开；网页预览不会发送数据或保存 Key。'); });
    return () => { alive = false; };
  }, [client, active]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; generation.current++;
      recognitionRef.current?.stop();
      if (requestRef.current) void client.cancelRequest(requestRef.current).catch(() => {});
      if (planRef.current?.status === 'pending') void client.cancelPlan(planRef.current.id).catch(() => {});
    };
  }, [client]);
  useEffect(() => {
    if (active) return;
    stop(false); setExpanded(false); recognitionRef.current?.stop();
    // Hiding for wallpaper/layout/modal must not discard the typed draft.
  }, [active]);
  useEffect(() => {
    if (!plan || plan.status !== 'pending') return;
    const delay = Math.max(0, plan.expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      const current = planRef.current;
      if (!current || current.id !== plan.id || current.status !== 'pending') return;
      const expired = { ...current, status: 'expired' as const };
      planRef.current = expired; setPlan(expired); syncPlan(expired); tick(n => n + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [plan]);
  useEffect(() => {
    if (!expanded) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && dockRef.current?.contains(event.target)) return;
      inputFocusedRef.current = false; inputRef.current?.blur();
      setExpanded(false);
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [expanded]);

  function adopt(next: Plan | null, replacedId?: string) {
    planRef.current = next; setPlan(next); setDirty(false); dirtyRef.current = false; setBlocked(false);
    setActions(next?.actions ?? []); setSelected(next?.actions.map(() => true) ?? []);
    setEdits(next?.actions.map(() => ({})) ?? []);
    if (next) setChatItems(items => replacedId && replacedId !== next.id
      ? items.map(item => item.kind === 'plan' && item.plan.id === replacedId ? { ...item, id: `plan:${next.id}`, plan: next } : item)
      : upsertPlanItem(items, next));
  }
  function syncPlan(next: Plan) {
    setChatItems(items => items.map(item => item.kind === 'plan' && item.plan.id === next.id ? { ...item, plan: next } : item));
  }
  function lock(value: boolean) { busyRef.current = value; setBusy(value); }
  function stop(showNotice = true) {
    const id = requestRef.current;
    if (!id) return;
    requestRef.current = null; generation.current++; setReading(false);
    void client.cancelRequest(id).catch(() => {});
    if (showNotice) setChatItems(items => [...items, { id: `status:${crypto.randomUUID()}`, kind: 'status', content: '已停止处理，未提交变更。已发出的网络请求可能仍在结束。' }]);
  }
  async function send() {
    if (!activeRef.current || requestRef.current || busyRef.current || (uncertain && !uncertain.preserveCurrent) || !draft.trim()) return;
    if (!connectionReady(config)) { setExpanded(true); return; }
    const message = draft.trim(); const requestId = crypto.randomUUID();
    const turn = ++generation.current; requestRef.current = requestId;
    const previous = planRef.current;
    setReading(true); setExpanded(true); setError('');
    setChatItems(items => [...items, { id: `user:${requestId}`, kind: 'message', role: 'user', content: message }]);
    try {
      if (previous?.status === 'pending') {
        await client.cancelPlan(previous.id);
        syncPlan({ ...previous, status: 'cancelled' });
        adopt(null);
      }
      if (turn !== generation.current) return;
      const response = await client.interpret({ requestId, message, history: historyMessages.current.slice(-12),
        previousPlanId: previous?.status === 'pending' || previous?.status === 'cancelled' ? previous.id : null });
      if (turn !== generation.current || !mounted.current || !activeRef.current) {
        if (response.plan) void client.cancelPlan(response.plan.id).catch(() => {});
        return;
      }
      // Keep the assistant's own turn: without it a clarification round trip
      // makes the model re-ask what it already asked.
      historyMessages.current = [...historyMessages.current,
        { role: 'user' as const, content: message },
        { role: 'assistant' as const, content: response.message }].slice(-12);
      setChatItems(items => {
        const replies: ChatItem[] = [
        ...(response.message ? [{ id: `assistant:${requestId}`, kind: 'message' as const, role: 'assistant' as const, content: response.message }] : []),
        ...(response.records.length ? [{ id: `records:${requestId}`, kind: 'records' as const, records: response.records }] : [])];
        const withReplies = [...items, ...replies];
        return response.plan ? upsertPlanItem(withReplies, response.plan) : withReplies;
      });
      setDraft(current => current.trim() === message ? '' : current); adopt(response.plan);
    } catch (e) {
      if (turn === generation.current && mounted.current) setError(assistantError(e));
    } finally {
      if (turn === generation.current && mounted.current) { requestRef.current = null; setReading(false); }
    }
  }
  function invalidate() {
    if (busyRef.current || blocked || !planRef.current) return;
    if (!dirtyRef.current) {
      const invalidatedPlanId = planRef.current.id;
      dirtyRef.current = true; setDirty(true);
      void client.cancelPlan(invalidatedPlanId).catch(() => {
        if (mounted.current && planRef.current?.id === invalidatedPlanId) {
          setBlocked(true); setError('无法核实旧预览已取消。请重新发送请求。');
        }
      });
    }
  }
  function edit(index: number, fields: Fields) {
    invalidate();
    setEdits(current => current.map((value, i) => i === index ? { ...value, ...fields } : value));
    setActions(current => current.map((a, i) => i !== index ? a : 'draft' in a ? { ...a, draft: { ...a.draft, ...fields } } : 'patch' in a ? { ...a, patch: { ...a.patch, ...fields } } : a));
  }
  async function revise() {
    if (!planRef.current || busyRef.current || !dirtyRef.current) return;
    lock(true); setError('');
    const turn = generation.current;
    try {
      const next = await client.revise(planRef.current.id, actions.filter((_, i) => selected[i]));
      if (!mounted.current || turn !== generation.current || !activeRef.current) { void client.cancelPlan(next.id).catch(() => {}); return; }
      adopt(next, planRef.current.id);
    } catch (e) { setError(assistantError(e)); }
    finally { if (mounted.current) lock(false); }
  }
  async function acceptReceipt(next: Plan, undo: boolean, preserveCurrent = false) {
    if (!preserveCurrent) adopt(next); else syncPlan(next);
    setHistory(items => items?.map(item => item.id === next.id ? next : item) ?? null);
    if (next.status === 'committed' || next.status === 'undone') {
      setUncertain(null);
      if (preserveCurrent) setHistoryError('');
      else { setBlocked(false); setError(''); }
      try { await onRefresh(); }
      catch {
        const message = '操作已保存，但界面刷新失败，请重新打开相关模块。';
        if (preserveCurrent) setHistoryError(message); else setError(message);
      }
    } else {
      const message = undo ? '尚未确认撤销成功，请检查操作记录。' : '未确认执行成功，请重新生成预览。';
      if (preserveCurrent) setHistoryError(message);
      else { setBlocked(true); setError(message); }
      setUncertain(null);
    }
  }
  async function recover(id: string, undo: boolean, cause?: unknown, preserveCurrent = false) {
    try {
      const receipt = await client.status(id);
      if (undo && receipt.status === 'committed') {
        const message = cause ? assistantError(cause) : '尚未撤销；记录仍为已执行。请检查数据是否已有后续修改。';
        setUncertain(null);
        if (preserveCurrent) setHistoryError(message); else setError(message);
        return;
      }
      await acceptReceipt(receipt, undo, preserveCurrent);
    }
    catch {
      const message = `执行状态尚未核实，请勿重复操作。${cause ? ` ${assistantError(cause)}` : ''}`;
      setUncertain({ id, undo, preserveCurrent });
      if (preserveCurrent) setHistoryError(message);
      else { setBlocked(true); setError(message); }
    }
  }
  async function execute(undo = false, target = planRef.current) {
    if (!target || busyRef.current || requestRef.current || (uncertain && (undo || !uncertain.preserveCurrent)) || !activeRef.current) return;
    if (!undo && (dirtyRef.current || blocked || target.status !== 'pending' || target.expiresAt <= Date.now())) return;
    const preserveCurrent = undo && target.id !== planRef.current?.id;
    lock(true);
    if (preserveCurrent) setHistoryError(''); else setError('');
    try {
      let next: Plan;
      try { next = await (undo ? client.undo(target.id) : client.execute(target.id)); }
      catch (e) { await recover(target.id, undo, e, preserveCurrent); return; }
      await acceptReceipt(next, undo, preserveCurrent);
    } finally { if (mounted.current) lock(false); }
  }
  async function cancelPlan() {
    if (!planRef.current || busyRef.current) return;
    lock(true);
    try {
      await client.cancelPlan(planRef.current.id);
      const cancelled = { ...planRef.current, status: 'cancelled' as const };
      adopt(cancelled); setError('');
    }
    catch (e) { setError(assistantError(e)); setBlocked(true); }
    finally { lock(false); }
  }
  async function refreshHistory() {
    lock(true);
    try {
      setHistory(await client.history()); setHistoryError(''); return true;
    } catch (cause) { setHistoryError(assistantError(cause)); return false; }
    finally { lock(false); }
  }
  async function toggleHistory() {
    if (busyRef.current || requestRef.current) return;
    if (surface === 'history') {
      if (!expanded) {
        setExpanded(true);
        await refreshHistory();
        return;
      }
      setSurface('chat'); setExpanded(historyReturnExpanded.current);
      return;
    }
    historyReturnExpanded.current = expanded;
    setSurface('history'); setExpanded(true); setHistoryRange('7'); setOpenChange(null);
    await refreshHistory();
  }
  function showChat() {
    setSurface('chat'); setExpanded(true);
  }
  function closePanel() {
    setExpanded(false);
  }
  function dictate() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const Recognizer = speechRecognition();
    if (!Recognizer) { setError('当前环境不支持语音输入，请改用键盘输入。'); setExpanded(true); return; }
    const recognition = new Recognizer();
    recognition.lang = 'zh-CN'; recognition.interimResults = false; recognition.continuous = false;
    recognition.onresult = event => {
      const text = Array.from(event.results, result => result[0]?.transcript ?? '').join('').trim();
      if (text) setDraft(current => current.trim() ? `${current.trim()} ${text}` : text);
    };
    recognition.onerror = () => { setError('语音输入失败，请检查麦克风权限。'); setExpanded(true); };
    recognition.onend = () => { recognitionRef.current = null; if (mounted.current) setListening(false); };
    recognitionRef.current = recognition; setListening(true);
    recognition.start();
  }
  const visibleItems: ChatItem[] = [...chatItems,
    ...(reading ? [{ id: 'status:reading', kind: 'status' as const, content: '正在理解与查询…尚未执行任何变更。' }] : []),
    ...(error && (!uncertain || uncertain.preserveCurrent) && surface === 'chat' ? [{ id: 'status:error', kind: 'status' as const, content: error, tone: 'error' as const }] : [])];
  const panelTitle = surface === 'history' ? '操作记录' : '当前聊天';
  const panelBadge = surface === 'history' ? `${historyCount(history ?? [], historyRange)} 条` : `${visibleItems.length} 条`;
  const PanelIcon = surface === 'history' ? History : MessageCircle;
  return <div ref={dockRef} className="assistant-dock" hidden={!active} aria-label="Nowly AI 助手">
    <section className="assistant-panel" aria-label={panelTitle} data-state={surface} data-open={expanded} aria-hidden={!expanded}>
      <header className="assistant-panel-header"><div className="assistant-panel-title">
        <span className="assistant-state-icon" aria-hidden="true"><PanelIcon size={18} /></span>
        <h2>{panelTitle}</h2><span className="assistant-state-badge">{panelBadge}</span>
      </div>
        <button className="btn btn-icon" aria-label="收起助手" onClick={closePanel}><ChevronDown size={18} /></button></header>
      <div className="assistant-panel-body" aria-live="polite">
        {surface === 'history' ? <>
          {historyError && <p role="alert" className="assistant-error">{historyError}</p>}
          {uncertain && <button className="btn" disabled={busy} onClick={() => void (async () => { lock(true); try { await recover(uncertain.id, uncertain.undo, undefined, uncertain.preserveCurrent); } finally { lock(false); } })()}>核实操作状态</button>}
          <AssistantHistory plans={history ?? []} range={historyRange} openChange={openChange} busy={busy} uncertain={Boolean(uncertain)}
            onRangeChange={setHistoryRange} onOpenChange={setOpenChange} onUndo={target => void execute(true, target)} />
        </> : <>{(connectionError || !connectionReady(config)) && <div className="assistant-system-card">
          <p role={connectionError ? 'alert' : 'status'}>{connectionError || '先在设置的“模型设置”里连接你的 AI 服务，并选择允许访问的数据范围。'}</p>
          {!connectionError && onOpenSettings && <button className="btn btn-primary" onClick={onOpenSettings}>打开模型设置</button>}
        </div>}
        <AssistantChat items={visibleItems} currentPlanId={plan?.id ?? null} actions={actions} edits={edits} selected={selected}
          dirty={dirty} busy={busy} blocked={blocked || Boolean(uncertain && !uncertain.preserveCurrent)}
          uncertainPlanId={uncertain && !uncertain.preserveCurrent ? uncertain.id : null} openChange={openChange} onEdit={edit}
          onSelect={(i, checked) => { invalidate(); setSelected(current => current.map((value, index) => index === i ? checked : value)); }}
          onRevise={() => void revise()} onConfirm={() => void execute()} onCancel={() => void cancelPlan()}
          onUndo={target => void execute(true, target)} onRecover={() => { if (uncertain) void (async () => { lock(true); try { await recover(uncertain.id, uncertain.undo, undefined, uncertain.preserveCurrent); } finally { lock(false); } })(); }} onOpenChange={setOpenChange}
          onOpenRecord={async (record, trigger) => { try { await onOpenRecord?.(record, inputRef.current ?? trigger); setExpanded(false); } catch (cause) { setError(assistantError(cause)); } }} />
        </>}
      </div>
    </section>
    <div className="assistant-composer" data-busy={reading || busy}>
      <span className="assistant-composer-mark" aria-hidden="true"><Sparkles size={18} /></span>
      <textarea ref={inputRef} aria-label="告诉 Nowly 你想做什么" rows={1} maxLength={4000}
        placeholder="告诉 Nowly 你想做什么…" value={draft} disabled={busy || Boolean(uncertain && !uncertain.preserveCurrent)}
        onFocus={() => {
          inputFocusedRef.current = true;
          if (!connectionReady(config)) { setExpanded(true); return; }
          showChat();
        }}
        onBlur={() => { inputFocusedRef.current = false; }}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.currentTarget.blur(); closePanel(); return; }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send(); }
        }} />
      <div className="assistant-composer-tools">
        <button className={`btn btn-icon${surface === 'history' && expanded ? ' is-active' : ''}`} aria-label="操作记录"
          aria-pressed={surface === 'history' && expanded} disabled={busy || reading} onClick={() => void toggleHistory()}><History size={18} /></button>
        {reading ? <button className="btn btn-icon assistant-stop" aria-label="停止处理" onClick={() => stop()}><Square size={14} fill="currentColor" /></button>
          : draft.trim() ? <button className="btn btn-icon btn-primary" aria-label="发送请求" disabled={busy || Boolean(uncertain && !uncertain.preserveCurrent)} onClick={() => void send()}><Send size={18} /></button>
            : <button className={`btn btn-icon${listening ? ' assistant-listening' : ''}`} aria-label="语音输入" aria-pressed={listening}
              disabled={busy || Boolean(uncertain && !uncertain.preserveCurrent)} onClick={dictate}><Mic size={18} /></button>}
      </div>
    </div>
  </div>;
}

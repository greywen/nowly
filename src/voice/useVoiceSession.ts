import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import { assistantError } from '../assistant/client';
import type { Plan } from '../assistant/types';
import { voiceLinger, voiceShell, type VoiceLocal, type VoiceSnapshot, type VoiceStage } from './voice-model';

export type VoiceRail = 'off' | 'primed' | 'narrow' | 'wide';
type NativeShell = 'off' | 'narrow' | 'wide';

const rank: Record<NativeShell, number> = { off: 0, narrow: 1, wide: 2 };

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isSnapshot(value: unknown): value is VoiceSnapshot {
  return typeof value === 'object' && value !== null
    && typeof (value as { seq?: unknown }).seq === 'number'
    && typeof (value as { phase?: unknown }).phase === 'string';
}

/** Leaves the native clip wide until the 220ms collapse has finished. */
const SHRINK_SETTLE_MS = 240;

export type VoiceSession = {
  snapshot: VoiceSnapshot | null;
  stage: VoiceStage | null;
  /** The rail's voice form: `primed` only swaps the Logo slot. */
  rail: VoiceRail;
  anim: 'grow' | 'shrink' | null;
  /** When the current listening / interpreting phase began. */
  since: number;
  busy: boolean;
  /** Whole seconds left before a confirm card executes; `null` otherwise. */
  countdown: number | null;
  undo: (plan: Plan) => void;
  confirm: (plan: Plan) => void;
  cancel: (plan: Plan) => void;
  dismiss: () => void;
};

/**
 * Follows the native voice session and owns everything the Bar adds on top:
 * the undo window, the confirm countdown, the Bar's own undo / confirm /
 * cancel outcomes, and when
 * the native clip may widen or narrow around the 288↔432 morph.
 */
export function useVoiceSession({ paused }: { paused: boolean }): VoiceSession {
  const [snapshot, setSnapshot] = useState<VoiceSnapshot | null>(null);
  const [local, setLocal] = useState<{ seq: number; stage: VoiceLocal } | null>(null);
  const [busy, setBusy] = useState(false);
  const [since, setSince] = useState(() => Date.now());

  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | undefined;
    void listen<VoiceSnapshot>('voice-session', event => {
      if (isSnapshot(event.payload)) setSnapshot(event.payload);
    }).then(unlisten => { if (disposed) unlisten(); else remove = unlisten; });
    void invoke<unknown>('voice_state')
      .then(initial => { if (!disposed && isSnapshot(initial)) setSnapshot(current => current ?? initial); })
      .catch(() => {});
    return () => { disposed = true; remove?.(); };
  }, []);

  const stage: VoiceStage | null = snapshot
    ? local && local.seq === snapshot.seq && snapshot.phase !== 'listening' && snapshot.phase !== 'idle'
      ? local.stage
      : snapshot
    : null;
  const phase = stage?.phase ?? 'idle';
  const view = stage ? voiceShell(stage) : 'off';
  const rail: VoiceRail = view === 'off' && snapshot?.primed ? 'primed' : view;

  const phaseKey = `${snapshot?.seq ?? 0}:${phase}`;
  useEffect(() => {
    if (phase === 'listening' || phase === 'interpreting') setSince(Date.now());
  }, [phaseKey, phase]);

  const dismiss = useCallback(() => {
    setLocal(null);
    void invoke('voice_dismiss').catch(() => {});
  }, []);

  // Native clip: widen at once, narrow only after the shell has shrunk.
  const native: NativeShell = rail === 'primed' ? 'narrow' : rail;
  const reported = useRef<NativeShell>('off');
  useEffect(() => {
    const report = () => {
      reported.current = native;
      void invoke('set_status_island_voice', { surface: native }).catch(() => {});
    };
    if (rank[native] >= rank[reported.current]) {
      if (native !== reported.current) report();
      return;
    }
    const timer = setTimeout(report, reducedMotion() ? 0 : SHRINK_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [native]);

  // The width morph's direction. Cleared once the rail is back to normal so
  // the status panel's own transitions are untouched.
  // Derived during render: the direction must land in the same commit as the
  // width change, or the browser sees the new width without a transition.
  const [morph, setMorph] = useState<{ view: typeof view; anim: 'grow' | 'shrink' | null }>({ view, anim: null });
  let anim = morph.anim;
  if (morph.view !== view) {
    anim = view === 'wide' ? 'grow' : morph.view === 'wide' ? 'shrink' : morph.anim;
    setMorph({ view, anim });
  }
  useEffect(() => {
    if (view !== 'off') return;
    const timer = setTimeout(() => setMorph(current => current.view === 'off' ? { view: 'off', anim: null } : current),
      SHRINK_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [view]);

  const seq = snapshot?.seq ?? 0;
  const run = useCallback(async (work: () => Promise<VoiceLocal | null>) => {
    setBusy(true);
    try {
      const next = await work();
      if (next) setLocal({ seq, stage: next });
      else dismiss();
    } catch (reason) {
      setLocal({ seq, stage: { phase: 'error', kind: 'failed', message: assistantError(reason), transcript: '' } });
    } finally {
      setBusy(false);
    }
  }, [dismiss, seq]);

  const transcript = stage && 'transcript' in stage ? stage.transcript : '';
  const undo = useCallback((plan: Plan) => void run(async () => {
    await invoke('assistant_undo', { planId: plan.id });
    const title = plan.changes.length === 1 ? plan.changes[0]!.title : '';
    return { phase: 'undone', title };
  }), [run]);
  const confirm = useCallback((plan: Plan) => void run(async () => {
    const committed = await invoke<Plan>('assistant_execute', { planId: plan.id });
    return { phase: 'created', transcript, plan: committed };
  }), [run, transcript]);
  const cancel = useCallback((plan: Plan) => void run(async () => {
    await invoke('assistant_cancel_plan', { planId: plan.id });
    return null;
  }), [run]);

  // Each result's window pauses under the pointer or keyboard focus, then
  // resumes with the time it had left. A confirm card executes when its
  // window ends; every other stage dismisses.
  const lingerKey = stage ? `${snapshot?.seq ?? 0}:${phase}:${local?.stage.phase ?? ''}` : '';
  const remaining = useRef<{ key: string; ms: number } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  useEffect(() => {
    const total = stage ? voiceLinger(stage) : null;
    const pending = stage?.phase === 'confirm' ? stage.plan : null;
    if (!stage || total === null) {
      setCountdown(null);
      return;
    }
    if (remaining.current?.key !== lingerKey) remaining.current = { key: lingerKey, ms: total };
    const slot = remaining.current;
    const seconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));
    setCountdown(pending ? seconds(slot.ms) : null);
    if (paused || busy) return;
    const started = Date.now();
    const left = () => Math.max(0, slot.ms - (Date.now() - started));
    const timer = setTimeout(pending ? () => confirm(pending) : dismiss, slot.ms);
    const tick = pending ? setInterval(() => setCountdown(seconds(left())), 250) : undefined;
    return () => {
      clearTimeout(timer);
      if (tick) clearInterval(tick);
      if (remaining.current === slot) slot.ms = left();
    };
    // `stage` is fully described by lingerKey for timing purposes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lingerKey, paused, busy, dismiss, confirm]);

  return {
    snapshot, stage: stage && stage.phase !== 'idle' ? stage : null, rail, anim, since, busy, countdown,
    undo, confirm, cancel, dismiss
  };
}

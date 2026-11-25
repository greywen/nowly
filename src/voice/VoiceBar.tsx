import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  CalendarDays,
  Check,
  CircleAlert,
  FileText,
  LayoutGrid,
  MessageCircle,
  Mic,
  Pencil,
  Sparkles,
  Stop,
  Trash2,
  UndoLeft,
  X
} from '../components/icons';
import { useTranslation } from '../i18n';
import type { Plan } from '../assistant/types';
import { VoiceWave } from './VoiceWave';
import {
  CONFIRM_MS,
  createdDetail,
  formatElapsed,
  holdKeyLabel,
  modifyDetail,
  resultFamily,
  voiceShell,
  withClient,
  type VoiceErrorKind,
  type VoiceStage
} from './voice-model';
import type { VoiceSession } from './useVoiceSession';

type Translate = ReturnType<typeof useTranslation>['t'];

function useElapsed(since: number, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [running, since]);
  return Math.max(0, now - since);
}

/** Long transcripts keep their newest words in view. */
function tail(text: string): string {
  return text.length > 40 ? `…${text.slice(-40)}` : text;
}

const errorCopy: Record<VoiceErrorKind, { title: string; meta: string }> = {
  modelMissing: { title: 'voice.error.modelMissing', meta: 'voice.error.modelMissingHint' },
  microphone: { title: 'voice.error.microphone', meta: 'voice.error.microphoneHint' },
  microphoneDenied: { title: 'voice.error.microphoneDenied', meta: 'voice.error.microphoneDeniedHint' },
  notConfigured: { title: 'voice.error.notConfigured', meta: 'voice.error.notConfiguredHint' },
  empty: { title: 'voice.error.empty', meta: 'voice.error.emptyHint' },
  failed: { title: 'voice.error.failed', meta: 'voice.error.failedHint' }
};

type Copy = {
  family: string;
  icon: React.ReactElement;
  title: string;
  meta: string;
  muted?: boolean;
};

/**
 * A plan's result copy. `countdown` is set on a confirm card: its meta line
 * leads with "N 秒后执行" instead of "已创建" (§12.9).
 */
function resultCopy(plan: Plan, t: Translate, countdown: number | null = null): Copy {
  const family = resultFamily(plan.changes);
  const first = plan.changes[0];
  const count = plan.changes.length;
  const separator = t('assistant.separator');
  const lead = (status: string, detail: string) => detail ? `${status} · ${detail}` : status;
  const status = countdown === null ? t('voice.created') : t('voice.countdown', { seconds: countdown });
  if (family === 'modify' || family === 'delete') {
    const verb = family === 'delete' ? 'voice.delete' : 'voice.modify';
    const detail = modifyDetail(plan.changes, plan, separator);
    return {
      family,
      icon: family === 'delete' ? <Trash2 aria-hidden="true" /> : <Pencil aria-hidden="true" />,
      title: withClient(plan, count === 1 ? t(verb, { title: first?.title ?? '' }) : t(`${verb}Many`, { count })),
      meta: countdown === null ? detail : lead(status, detail)
    };
  }
  if (family === 'many') {
    const titles = plan.changes.map(change => change.title).join(separator);
    return {
      family,
      icon: <Check aria-hidden="true" />,
      title: withClient(plan, t('voice.createdMany', { count })),
      meta: countdown === null ? titles : lead(status, titles)
    };
  }
  const icon = family === 'event' ? <CalendarDays aria-hidden="true" />
    : family === 'task' ? <LayoutGrid aria-hidden="true" />
    : family === 'alarm' ? <Bell aria-hidden="true" />
    : <FileText aria-hidden="true" />;
  return {
    family,
    icon,
    title: withClient(plan, first?.title ?? ''),
    meta: lead(status, first ? createdDetail(first, plan, t) : '')
  };
}

function stageCopy(stage: VoiceStage, t: Translate, extra: {
  holdKey: string;
  quiet: boolean;
  elapsed: number;
  countdown: number | null;
}): Copy {
  const key = holdKeyLabel(extra.holdKey);
  switch (stage.phase) {
    case 'listening':
      return {
        family: 'voice',
        icon: <Mic aria-hidden="true" />,
        title: stage.transcript ? tail(stage.transcript) : t('voice.listening'),
        muted: !stage.transcript,
        meta: extra.quiet ? t('voice.noSound') : t('voice.releaseHint', { key })
      };
    case 'interpreting':
      return {
        family: 'voice',
        icon: <Sparkles aria-hidden="true" />,
        title: tail(stage.transcript),
        meta: t('voice.interpreting', { seconds: Math.floor(extra.elapsed / 1000) })
      };
    case 'clarify':
      return {
        family: 'voice',
        icon: <MessageCircle aria-hidden="true" />,
        title: stage.message,
        meta: t('voice.clarifyHint', { key })
      };
    case 'answer':
      return {
        family: 'voice',
        icon: <MessageCircle aria-hidden="true" />,
        title: stage.message,
        meta: stage.transcript
      };
    case 'error': {
      const copy = errorCopy[stage.kind];
      const failed = stage.kind === 'failed' && stage.message;
      return {
        family: 'error',
        icon: <CircleAlert aria-hidden="true" />,
        title: failed ? stage.message : t(copy.title),
        meta: failed && stage.transcript ? stage.transcript : t(copy.meta)
      };
    }
    case 'created':
      return resultCopy(stage.plan, t);
    case 'confirm':
      return resultCopy(stage.plan, t, extra.countdown ?? Math.ceil(CONFIRM_MS / 1000));
    case 'undone':
      return {
        family: 'undone',
        icon: <UndoLeft aria-hidden="true" />,
        title: stage.title || t('voice.undoneTitle'),
        meta: t('voice.undone')
      };
    default:
      return { family: 'voice', icon: <Mic aria-hidden="true" />, title: '', meta: '' };
  }
}

function errorAction(kind: VoiceErrorKind, transcript: string, t: Translate): { label: string; run: () => void } | null {
  switch (kind) {
    case 'modelMissing':
      return { label: t('voice.action.download'), run: () => void invoke('voice_open_settings', { section: 'voice' }) };
    case 'microphone':
      return { label: t('voice.action.settings'), run: () => void invoke('voice_open_settings', { section: 'voice' }) };
    case 'microphoneDenied':
      return { label: t('voice.action.privacy'), run: () => void invoke('voice_open_microphone_privacy') };
    case 'notConfigured':
      return { label: t('voice.action.settings'), run: () => void invoke('voice_open_settings', { section: 'model' }) };
    case 'failed':
      return transcript
        ? { label: t('voice.action.copy'), run: () => void navigator.clipboard?.writeText(transcript) }
        : null;
    default:
      return null;
  }
}

function IconButton({ label, onClick, disabled, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactElement;
}) {
  return (
    <button type="button" className="voice-island__icon-button" aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function Trailing({ stage, session, quietChange, elapsed, t }: {
  stage: VoiceStage;
  session: VoiceSession;
  quietChange: (quiet: boolean) => void;
  elapsed: number;
  t: Translate;
}) {
  const busy = session.busy;
  switch (stage.phase) {
    case 'listening':
      return <>
        <VoiceWave seq={session.snapshot?.seq ?? 0} onQuietChange={quietChange} />
        <span className="voice-island__timer">{formatElapsed(elapsed)}</span>
      </>;
    case 'interpreting':
      return <IconButton label={t('voice.stop')} onClick={session.dismiss}><Stop aria-hidden="true" /></IconButton>;
    case 'created':
      return <button type="button" className="voice-island__text-button" disabled={busy}
        aria-label={t('voice.undoLabel', { title: resultCopy(stage.plan, t).title })}
        onClick={() => session.undo(stage.plan)}>{t('voice.undo')}</button>;
    case 'confirm':
      return <>
        <IconButton label={t('voice.confirm')} disabled={busy} onClick={() => session.confirm(stage.plan)}><Check aria-hidden="true" /></IconButton>
        <IconButton label={t('voice.cancel')} disabled={busy} onClick={() => session.cancel(stage.plan)}><X aria-hidden="true" /></IconButton>
      </>;
    case 'clarify':
    case 'answer':
      return <IconButton label={t('voice.close')} onClick={session.dismiss}><X aria-hidden="true" /></IconButton>;
    case 'error': {
      const action = errorAction(stage.kind, stage.transcript, t);
      return <>
        {action && <button type="button" className="voice-island__text-button" onClick={action.run}>{action.label}</button>}
        <IconButton label={t('voice.close')} onClick={session.dismiss}><X aria-hidden="true" /></IconButton>
      </>;
    }
    default:
      return null;
  }
}

function VoiceIsland({ stage, session, at }: { stage: VoiceStage; session: VoiceSession; at: 'narrow' | 'wide' }) {
  const { t } = useTranslation();
  const [quiet, setQuiet] = useState(false);
  const running = stage.phase === 'listening' || stage.phase === 'interpreting';
  const elapsed = useElapsed(session.since, running);
  useEffect(() => { if (stage.phase !== 'listening') setQuiet(false); }, [stage.phase]);
  const copy = stageCopy(stage, t, {
    holdKey: session.snapshot?.holdKey ?? '', quiet, elapsed, countdown: session.countdown
  });
  return (
    <div className="status-island voice-island" data-at={at} data-phase={stage.phase} data-primary={copy.family}
      {...(copy.muted ? { 'data-muted': 'true' } : {})}>
      <span className="status-island__content">
        <span className="status-island__icon">{copy.icon}</span>
        <span className="status-island__copy">
          <strong className="voice-island__title"><span>{copy.title}</span></strong>
          <span>{copy.meta}</span>
        </span>
      </span>
      <span className="voice-island__trailing">
        <Trailing stage={stage} session={session} quietChange={setQuiet} elapsed={elapsed} t={t} />
      </span>
    </div>
  );
}

/** One sentence per stage for screen readers; partial transcripts stay quiet. */
function announcement(stage: VoiceStage | null, t: Translate): string {
  if (!stage) return '';
  if (stage.phase === 'listening') return t('voice.listening');
  if (stage.phase === 'interpreting') return t('voice.interpretingSpoken');
  const copy = stageCopy(stage, t, { holdKey: '', quiet: false, elapsed: 0, countdown: null });
  return [copy.title, copy.meta].filter(Boolean).join(' · ');
}

/**
 * The capsule's voice content (design.md §12.9). Two fixed layouts, one at
 * 432px and one on the 288px capsule slots, cross-fade the way the rail's two
 * close keys do. Each keeps the last stage it showed so its exit fade carries
 * real content instead of blanking first.
 */
export function VoiceLayers({ session }: { session: VoiceSession }) {
  const { t } = useTranslation();
  const stage = session.stage;
  const shell = stage ? voiceShell(stage) : 'off';
  const lastWide = useRef<VoiceStage | null>(null);
  const lastNarrow = useRef<VoiceStage | null>(null);
  if (stage && shell === 'wide') lastWide.current = stage;
  if (stage && shell === 'narrow') lastNarrow.current = stage;
  const spokenKey = stage ? `${session.snapshot?.seq}:${stage.phase}` : '';
  const [spoken, setSpoken] = useState('');
  useEffect(() => { setSpoken(announcement(stage, t)); },
    // Announce once per stage, not on every partial transcript.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spokenKey, t]);
  return <>
    {(['wide', 'narrow'] as const).map(at => {
      const shown = shell === at;
      const content = at === 'wide' ? lastWide.current : lastNarrow.current;
      return (
        <div key={at} className="status-rail__voice" data-at={at} data-shown={shown}
          aria-hidden={!shown} inert={!shown}>
          {content && <VoiceIsland stage={content} session={session} at={at} />}
        </div>
      );
    })}
    <span className="visually-hidden" role="status" aria-live="polite">{spoken}</span>
  </>;
}

import type { Change, Fields, Plan } from '../assistant/types';
import { displayField } from '../assistant/PlanCard';
import { getLocale } from '../i18n';

export type VoiceErrorKind = 'modelMissing' | 'microphone' | 'microphoneDenied' | 'notConfigured' | 'empty' | 'failed';

/** Mirrors `voice::session::View` (serde tag `phase`). */
export type VoiceView =
  | { phase: 'idle' }
  | { phase: 'listening'; transcript: string }
  | { phase: 'interpreting'; transcript: string }
  | { phase: 'created'; transcript: string; plan: Plan }
  | { phase: 'confirm'; transcript: string; plan: Plan }
  | { phase: 'clarify'; transcript: string; message: string }
  | { phase: 'answer'; transcript: string; message: string }
  | { phase: 'error'; kind: VoiceErrorKind; message: string; transcript: string };

export type VoiceSnapshot = { seq: number; holdKey: string; primed: boolean } & VoiceView;

/** Frontend-only outcomes of the Bar's own buttons. */
export type VoiceLocal =
  | { phase: 'undone'; title: string }
  | { phase: 'created'; transcript: string; plan: Plan }
  | { phase: 'error'; kind: 'failed'; message: string; transcript: string };

export type VoiceStage = VoiceView | VoiceLocal;

/** Which shell the stage needs: §12.9 keeps text-heavy states at 432px. */
export function voiceShell(stage: VoiceStage): 'off' | 'narrow' | 'wide' {
  switch (stage.phase) {
    case 'idle': return 'off';
    case 'created': case 'confirm': case 'undone': return 'narrow';
    default: return 'wide';
  }
}

/** How long a stage stays without input, in ms. `null` waits for the user. */
export function voiceLinger(stage: VoiceStage): number | null {
  switch (stage.phase) {
    case 'created': return 30_000;
    case 'undone': return 1_500;
    case 'error': return stage.kind === 'empty' ? 3_000 : 30_000;
    case 'clarify': case 'answer': return 30_000;
    default: return null;
  }
}

export type ResultFamily = 'event' | 'task' | 'note' | 'many' | 'modify' | 'delete';

export function resultFamily(changes: Change[]): ResultFamily {
  if (changes.some(change => change.kind.startsWith('delete'))) return 'delete';
  if (changes.some(change => change.kind.startsWith('update'))) return 'modify';
  if (changes.length !== 1) return 'many';
  const kind = changes[0]!.kind;
  return kind === 'createEvent' ? 'event' : kind === 'createTask' ? 'task' : 'note';
}

function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** "今天 15:00–16:00", "明天 全天", "11月28日 09:30". */
export function eventWhen(fields: Fields, t: Translate, now = new Date()): string {
  const start = typeof fields.startAt === 'string' ? fields.startAt : '';
  if (!start) return '';
  const end = typeof fields.endAt === 'string' ? fields.endAt : '';
  const date = start.slice(0, 10);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const [year, month, day] = date.split('-').map(Number);
  const dayLabel = date === localDay(now) ? t('voice.today')
    : date === localDay(tomorrow) ? t('voice.tomorrow')
    : new Date(year!, month! - 1, day!).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' });
  if (fields.allDay === true || start.length <= 10) return `${dayLabel} ${t('voice.allDay')}`;
  const from = start.slice(11, 16);
  const to = end.slice(0, 10) === date ? end.slice(11, 16) : '';
  return `${dayLabel} ${from}${to ? `–${to}` : ''}`;
}

/** The meta line for one created item, after "已创建 · ". */
export function createdDetail(change: Change, plan: Plan, t: Translate): string {
  const after = change.after ?? {};
  if (change.kind === 'createEvent') return eventWhen(after, t);
  if (change.kind === 'createTask') {
    return after.priority ? displayField('priority', after.priority, plan) : t('voice.kindTask');
  }
  return t('voice.kindNote');
}

/** "15:00 → 16:00" for a single-field change; otherwise the item names. */
export function modifyDetail(changes: Change[], plan: Plan, separator: string): string {
  const [change] = changes;
  if (changes.length === 1 && change?.before && change.after) {
    const { before, after } = change;
    const keys = Object.keys(after).filter(key =>
      key !== 'color' && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    if (keys.length === 1) {
      const key = keys[0]!;
      const show = (value: unknown) => typeof value === 'string' && /T\d\d:\d\d/.test(value)
        ? value.slice(11, 16) : displayField(key, value, plan);
      return `${show(before[key])} → ${show(after[key])}`;
    }
  }
  return changes.map(item => item.title).join(separator);
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** "Ctrl+Super" → "Ctrl+Win" for display. */
export function holdKeyLabel(spec: string): string {
  return spec.split('+').map(part => part === 'Super' ? 'Win' : part).join('+');
}

import { DESIGN_COLORS, type ColorPreset, type HexColor } from '../lib/color';
import { t } from '../i18n';

export type NoteColor = HexColor;
export const NOTE_STYLE_VARIANT_COUNT = 9;
// Static value list (order matters, language-independent).
const noteColorValues = [
  { value: DESIGN_COLORS.warning, key: 'color.amber' },
  { value: DESIGN_COLORS.primary, key: 'color.teal' },
  { value: DESIGN_COLORS.success, key: 'color.green' },
  { value: DESIGN_COLORS.info, key: 'color.indigo' }
] as const;
// Language-aware presets: read the active language at call time.
export function noteColorPresets(): readonly ColorPreset[] {
  return noteColorValues.map(({ value, key }) => ({ value, label: t(key) }));
}
export const DEFAULT_NOTE_COLOR = DESIGN_COLORS.warning;
export const noteColors = noteColorValues.map(({ value }) => value) as readonly NoteColor[];

const noteIconValues = ['','smile','grin','love','cool','laugh','spark','star','heart','sad'] as const;
export type NoteIcon = typeof noteIconValues[number];

const noteIconSymbols: Record<NoteIcon, string> = {
  '': '',
  smile: '🙂',
  grin: '😀',
  love: '😍',
  cool: '😎',
  laugh: '😄',
  spark: '✨',
  star: '⭐',
  heart: '💙',
  sad: '🙁'
};

export function isNoteIcon(value: unknown): value is NoteIcon {
  return typeof value === 'string' && (noteIconValues as readonly string[]).includes(value);
}

export function normalizeNoteIcon(value: unknown): NoteIcon {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  return isNoteIcon(normalized) ? normalized : '';
}

export function noteIconOptions() {
  return [
    { value: '', symbol: noteIconSymbols[''], label: t('noteIcon.none') },
    { value: 'smile', symbol: noteIconSymbols.smile, label: t('noteIcon.smile') },
    { value: 'grin', symbol: noteIconSymbols.grin, label: t('noteIcon.grin') },
    { value: 'love', symbol: noteIconSymbols.love, label: t('noteIcon.love') },
    { value: 'cool', symbol: noteIconSymbols.cool, label: t('noteIcon.cool') },
    { value: 'laugh', symbol: noteIconSymbols.laugh, label: t('noteIcon.laugh') },
    { value: 'spark', symbol: noteIconSymbols.spark, label: t('noteIcon.spark') },
    { value: 'star', symbol: noteIconSymbols.star, label: t('noteIcon.star') },
    { value: 'heart', symbol: noteIconSymbols.heart, label: t('noteIcon.heart') },
    { value: 'sad', symbol: noteIconSymbols.sad, label: t('noteIcon.sad') }
  ] as const;
}

export function noteIconSymbol(icon: NoteIcon): string {
  return noteIconSymbols[icon] ?? '';
}

export type NoteDraft = {
  title: string;
  content: string;
  color: NoteColor;
  pinned: boolean;
  icon: NoteIcon;
};

export type Note = {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  pinned: boolean;
  styleVariant: number;
  icon: NoteIcon;
  createdAt: string;
  updatedAt: string;
};

// How the notes widget lays out its notes: a compact list or a sticky-note wall.
export type NotesViewMode = 'list' | 'board';
export const DEFAULT_NOTES_VIEW: NotesViewMode = 'list';
const notesViewModes: readonly NotesViewMode[] = ['list', 'board'];

export function isNotesViewMode(value: unknown): value is NotesViewMode {
  return typeof value === 'string' && notesViewModes.includes(value as NotesViewMode);
}

export function notesViewOptions(): Array<{ view: NotesViewMode; label: string; description: string }> {
  return [
    { view: 'list', label: t('notesWidget.viewList'), description: t('notesWidget.viewListDesc') },
    { view: 'board', label: t('notesWidget.viewBoard'), description: t('notesWidget.viewBoardDesc') }
  ];
}

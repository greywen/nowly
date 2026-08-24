import { DESIGN_COLORS, type ColorPreset, type HexColor } from '../lib/color';
import { t } from '../i18n';

export type NoteColor = HexColor;
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

export type NoteDraft = {
  title: string;
  content: string;
  color: NoteColor;
  pinned: boolean;
};

export type Note = {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  pinned: boolean;
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

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

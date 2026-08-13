import { DESIGN_COLORS, type ColorPreset, type HexColor } from '../lib/color';

export type NoteColor = HexColor;
export const noteColorPresets: readonly ColorPreset[] = [
  { value: DESIGN_COLORS.warning, label: '暖黄' },
  { value: DESIGN_COLORS.primary, label: '青绿' },
  { value: DESIGN_COLORS.success, label: '草绿' },
  { value: DESIGN_COLORS.info, label: '靛蓝' }
];
export const DEFAULT_NOTE_COLOR = DESIGN_COLORS.warning;
export const noteColors = noteColorPresets.map(({ value }) => value) as readonly NoteColor[];

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
